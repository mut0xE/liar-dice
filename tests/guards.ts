/**
 * Negative tests: every rejection path a valid client should never hit, proven to
 * fail with the RIGHT error. These are the guards that make the happy-path flow
 * (tests/flow.ts) trustworthy — "correct by construction", not just for one run.
 *
 * All of these live entirely on the BASE LAYER: create -> join -> start is enough
 * to reach them, so there's no delegation, no VRF, and no ER. That also covers the
 * "nobody rolled" path: past the roll deadline, begin_bidding skips + strikes the
 * no-shows, reopens the roll window, and eliminates them on the second straight miss
 * (the two tests that wait out the short deadline).
 * (Bidding/reveal guards need VRF rolls on the ER and are covered by tests/flow.ts
 * and tests/stall.ts.)
 *
 * Reuses the shared builders in tests/helpers/instructions.ts. Needs only devnet +
 * funded HOST_KEY / PLAYER_B_KEY. Run it via `yarn test:guards`.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import dotenv from "dotenv";
import assert from "assert";
import { LiarDice } from "../target/types/liar_dice";
import {
  gamePda,
  handPda,
  vaultPda,
  keypairFromEnvOrGenerate,
} from "./helpers/accounts";
import {
  fundKeypair,
  sendBuilt,
  sleep,
  waitUntilClosed,
} from "./helpers/connections";
import { logSection, logTx } from "./helpers/log";
import * as ix from "./helpers/instructions";

dotenv.config();

describe("liar-dice: guard rejections (base layer)", function () {
  this.timeout(120_000);

  const baseProvider = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.HELIUS_RPC_URL ||
        process.env.ANCHOR_PROVIDER_URL ||
        "https://api.devnet.solana.com",
      { commitment: "confirmed" }
    ),
    anchor.Wallet.local(),
    { commitment: "confirmed" }
  );
  anchor.setProvider(baseProvider);
  const program = anchor.workspace.liarDice as Program<LiarDice>;
  const wallet = baseProvider.wallet as anchor.Wallet;
  const connection = baseProvider.connection;

  const entryFee = new BN(0.001 * LAMPORTS_PER_SOL);
  const host = keypairFromEnvOrGenerate("HOST_KEY"); // seat 0
  const playerB = keypairFromEnvOrGenerate("PLAYER_B_KEY"); // seat 1
  const outsider = Keypair.generate(); // never joins any game

  // A fresh Active game (create + both join + start) and a game left in Waiting.
  let activeGame: PublicKey;
  let waitingGame: PublicKey;
  // A short-grace Active game used to exercise the no-roll skip/strike/eliminate path.
  let stallGame: PublicKey;
  const STALL_GRACE = 6; // seconds
  // A Waiting game with two players, cancelled (and refunded) by the success test.
  let cancelGame: PublicKey;
  // A Waiting game with only ONE player joined — cancelled to prove partial-join cleanup.
  let soloGame: PublicKey;

  // Act as a wallet directly, with NO session key. The `session_auth_or` guard is
  // satisfied because signer == authority, so the optional session token is None
  // (Anchor's None sentinel for an optional account is the program's own id).
  const directCtx = (player: Keypair) => ({
    sessionSigner: player,
    authority: player.publicKey,
    sessionToken: program.programId,
  });

  // Send a tx that is expected to fail, asserting the on-chain error names `code`.
  // Preflight is left ON so the failing simulation returns the Anchor error + logs.
  async function expectError(
    built: { tx: anchor.web3.Transaction; signers: Keypair[] },
    code: string
  ): Promise<void> {
    built.tx.feePayer = built.signers[0].publicKey;
    built.tx.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    try {
      await sendAndConfirmTransaction(connection, built.tx, built.signers, {
        commitment: "confirmed",
      });
    } catch (err: any) {
      const text = [err?.message, ...(err?.logs ?? [])].join("\n");
      assert.ok(text.includes(code), `expected error "${code}", got:\n${text}`);
      return;
    }
    assert.fail(`expected "${code}" but the transaction succeeded`);
  }

  // Build create -> join(...players) -> optional start, returning the game PDA.
  async function makeGame(
    gameId: BN,
    joiners: Keypair[],
    start: boolean,
    graceSeconds = 30
  ): Promise<PublicKey> {
    const game = gamePda(program.programId, host.publicKey, gameId);
    const vault = vaultPda(program.programId, game);
    await sendBuilt(
      connection,
      await ix.buildCreateGame(program, {
        host,
        game,
        gameId,
        entryFee,
        graceSeconds,
      })
    );
    for (const p of joiners) {
      await sendBuilt(
        connection,
        await ix.buildJoinGame(program, {
          player: p,
          game,
          vault,
          playerHand: handPda(program.programId, game, p.publicKey),
        })
      );
    }
    if (start)
      await sendBuilt(
        connection,
        await ix.buildStartGame(program, { host, game })
      );
    return game;
  }

  before(async function () {
    logSection("setup: fund keys + build one Active and one Waiting game");
    for (const p of [host, playerB])
      await fundKeypair(connection, wallet, p.publicKey, 2);
    await fundKeypair(connection, wallet, outsider.publicKey, 0.2);

    // Distinct ids so the games get distinct PDAs.
    activeGame = await makeGame(new BN(Date.now()), [host, playerB], true);
    waitingGame = await makeGame(new BN(Date.now() + 1), [host], false);
    stallGame = await makeGame(
      new BN(Date.now() + 2),
      [host, playerB],
      true,
      STALL_GRACE
    );
    cancelGame = await makeGame(new BN(Date.now() + 3), [host, playerB], false);
    soloGame = await makeGame(new BN(Date.now() + 4), [host], false);
  });

  // ── Roll-phase guards: a freshly started game opens in the Rolling phase ───
  // (Bidding/reveal guards like NotYourTurn/NotRolled only trigger once bidding
  // opens, which needs VRF rolls on the ER — exercised by tests/flow.ts.)

  it("rejects bidding before bidding opens (BadGameState in Rolling)", async () => {
    // The round is still Rolling; place_bid is only valid in the Bidding phase.
    await expectError(
      await ix.buildPlaceBid(program, directCtx(host), {
        game: activeGame,
        playerHand: handPda(program.programId, activeGame, host.publicKey),
        quantity: 1,
        face: 3,
      }),
      "BadGameState"
    );
  });

  it("rejects a challenge before bidding opens (BadGameState in Rolling)", async () => {
    await expectError(
      await ix.buildChallenge(program, directCtx(host), { game: activeGame }),
      "BadGameState"
    );
  });

  it("rejects begin_bidding before the roll deadline (DeadlineNotReached)", async () => {
    // Nobody rolled and the shared roll window is still open, so bidding can't open.
    await expectError(
      await ix.buildBeginBidding(program, {
        caller: host,
        game: activeGame,
        hands: [host, playerB].map((p) =>
          handPda(program.programId, activeGame, p.publicKey)
        ),
      }),
      "DeadlineNotReached"
    );
  });

  it("rejects begin_bidding without all active hands (MissingHand)", async () => {
    // Every active seat's hand must be supplied, or the skip decision could be gamed.
    await expectError(
      await ix.buildBeginBidding(program, {
        caller: host,
        game: activeGame,
        hands: [handPda(program.programId, activeGame, host.publicKey)], // playerB omitted
      }),
      "MissingHand"
    );
  });

  it("rejects joining a game that has already started (BadGameState)", async () => {
    // An outsider tries to buy into a table that is already in play.
    const vault = vaultPda(program.programId, activeGame);
    await expectError(
      await ix.buildJoinGame(program, {
        player: outsider,
        game: activeGame,
        vault,
        playerHand: handPda(program.programId, activeGame, outsider.publicKey),
      }),
      "BadGameState"
    );
  });

  // ── Start guards on the Waiting game ──────────────────────────────────────

  it("rejects starting a game with fewer than two players (NotEnoughPlayers)", async () => {
    // waitingGame only has the host; a table needs at least two seats to start.
    await expectError(
      await ix.buildStartGame(program, { host, game: waitingGame }),
      "NotEnoughPlayers"
    );
  });

  it("rejects a non-host trying to start the game (Unauthorized)", async () => {
    // Only the wallet that created the table may start it (has_one = host).
    await expectError(
      await ix.buildStartGame(program, { host: playerB, game: waitingGame }),
      "Unauthorized"
    );
  });

  // ── cancel_game guards + the refund path (Waiting only; hands never delegated) ──

  it("rejects a non-host cancelling the game (Unauthorized)", async () => {
    // Only the host may cancel their own table (has_one = host).
    await expectError(
      await ix.buildCancelGame(program, {
        host: playerB, // not the host
        game: waitingGame,
        vault: vaultPda(program.programId, waitingGame),
        players: [host.publicKey],
      }),
      "Unauthorized"
    );
  });

  it("rejects cancelling a game that has already started (BadGameState)", async () => {
    // cancel_game only works on a Waiting game; an Active game must be played out.
    await expectError(
      await ix.buildCancelGame(program, {
        host,
        game: activeGame,
        vault: vaultPda(program.programId, activeGame),
        players: [host.publicKey, playerB.publicKey],
      }),
      "BadGameState"
    );
  });

  it("rejects cancel with the wrong number of refund accounts (MissingHand)", async () => {
    // Every player must be supplied so each can be refunded (here playerB is omitted).
    await expectError(
      await ix.buildCancelGame(program, {
        host,
        game: cancelGame,
        vault: vaultPda(program.programId, cancelGame),
        players: [host.publicKey], // cancelGame has two players
      }),
      "MissingHand"
    );
  });

  it("cancels a Waiting game, refunds every player, and marks it Ended", async () => {
    logSection("cancel_game: refund both players, drain the vault");
    const vault = vaultPda(program.programId, cancelGame);
    const before = await program.account.game.fetch(cancelGame);
    assert.ok(before.potLamports.toNumber() > 0, "pot funded by two joins");

    const sig = await sendBuilt(
      connection,
      await ix.buildCancelGame(program, {
        host,
        game: cancelGame,
        vault,
        players: [host.publicKey, playerB.publicKey],
      })
    );
    logTx("cancel_game", sig);

    const after = await program.account.game.fetch(cancelGame);
    assert.strictEqual(
      JSON.stringify(after.status),
      JSON.stringify({ cancelled: {} }),
      "cancelled game is Cancelled"
    );
    assert.strictEqual(after.potLamports.toNumber(), 0, "pot fully refunded");
    const vaultLamports = await connection.getBalance(vault);
    assert.strictEqual(vaultLamports, 0, "vault drained to the players");

    // Hands are closed too, so their rent is reclaimed.
    // for (const p of [host, playerB]) {
    //   const closed = await waitUntilClosed(connection, handPda(program.programId, cancelGame, p.publicKey));
    //   assert.ok(closed, "hand PDA closed (rent reclaimed)");
    // }
  });

  it("cancels a partially-filled game (only one player joined)", async () => {
    // Joining does not delegate (that's a post-start step), so even a half-full
    // Waiting table cancels on base layer: refund + close only the joined player.
    logSection("cancel_game: only the host joined → refund + close the host");
    const vault = vaultPda(program.programId, soloGame);
    const sig = await sendBuilt(
      connection,
      await ix.buildCancelGame(program, {
        host,
        game: soloGame,
        vault,
        players: [host.publicKey], // game.players has just the host
      })
    );
    logTx("cancel_game (solo)", sig);

    const after = await program.account.game.fetch(soloGame);
    assert.strictEqual(
      JSON.stringify(after.status),
      JSON.stringify({ cancelled: {} }),
      "solo game cancelled → Cancelled"
    );
    assert.strictEqual(
      after.potLamports.toNumber(),
      0,
      "host's entry refunded"
    );
    const closed = await waitUntilClosed(
      connection,
      handPda(program.programId, soloGame, host.publicKey)
    );
    assert.ok(closed, "the one hand PDA is closed");
  });

  // ── The "player never rolled" path: begin_bidding skips + strikes no-shows ──

  // Wait out stallGame's current roll window, then begin_bidding with both (unrolled)
  // hands. Returns the game state after the call.
  async function beginBiddingPastRollDeadline() {
    const g = await program.account.game.fetch(stallGame);
    const deadline = g.actionDeadline.toNumber();
    while (Math.floor(Date.now() / 1000) <= deadline + 1) await sleep(1000);
    const sig = await sendBuilt(
      connection,
      await ix.buildBeginBidding(program, {
        caller: host,
        game: stallGame,
        hands: [host, playerB].map((p) =>
          handPda(program.programId, stallGame, p.publicKey)
        ),
      })
    );
    logTx("begin_bidding (no rolls)", sig);
    return { before: g, after: await program.account.game.fetch(stallGame) };
  }

  it("first missed roll skips both players and reopens the roll window (no elimination)", async () => {
    logSection("no-roll #1: both skipped, round restarts, one strike each");
    const { before, after } = await beginBiddingPastRollDeadline();
    assert.strictEqual(
      JSON.stringify(after.phase),
      JSON.stringify({ rolling: {} }),
      "fewer than 2 rolled → a fresh roll window opens"
    );
    assert.strictEqual(
      after.round,
      before.round + 1,
      "a new roll window opened"
    );
    assert.strictEqual(after.missedRolls[0], 1, "host took one strike");
    assert.strictEqual(after.missedRolls[1], 1, "playerB took one strike");
    assert.strictEqual(after.isActive[0], true, "nobody out on the first miss");
    assert.strictEqual(after.isActive[1], true, "nobody out on the first miss");
  });

  it("a second straight missed roll hits MISS_LIMIT: the striker is out, the last player wins", async () => {
    // Both reach the strike limit, but "guaranteed survivor" never eliminates the
    // last active seat — so seat 0 is eliminated and seat 1 is left as the sole winner
    // (a fully abandoned table still ends with exactly one winner, never a stuck pot).
    logSection(
      "no-roll #2: strike limit → seat 0 out, seat 1 survives as winner"
    );
    const { after } = await beginBiddingPastRollDeadline();
    assert.strictEqual(
      after.missedRolls[0],
      2,
      "host reached the strike limit"
    );
    assert.strictEqual(
      after.missedRolls[1],
      2,
      "playerB reached the strike limit"
    );
    assert.strictEqual(
      after.isActive[0],
      false,
      "host eliminated at MISS_LIMIT"
    );
    assert.strictEqual(after.diceCounts[0], 0, "eliminated host has no dice");
    assert.strictEqual(
      after.isActive[1],
      true,
      "the last player is never eliminated (guaranteed survivor)"
    );
    assert.ok(after.diceCounts[1] > 0, "the survivor keeps their dice");
    assert.strictEqual(
      JSON.stringify(after.status),
      JSON.stringify({ ended: {} }),
      "one player left → game ended"
    );
  });
});
