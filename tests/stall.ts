// Liveness test: a player never reveals after a challenge. Past the deadline
// anyone calls settle_round, which slashes the non-revealer and settles the bid.
// Needs live devnet + MagicBlock router + VRF oracle. Run via `yarn test:stall`.
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import dotenv from "dotenv";
import assert from "assert";
import { LiarDice } from "../target/types/liar_dice";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import {
  gamePda,
  vaultPda,
  permissionPda,
  programIdentityPda,
  keypairFromEnv,
} from "./helpers/accounts";
import {
  routerConnection,
  teeValidator,
  fundKeypair,
  sendBuilt,
  sleep,
  waitForRoll,
} from "./helpers/connections";
import {
  makePlayer,
  sessionCtx,
  sendTee,
  connectToTee,
  assertHandsPrivate,
} from "./helpers/player";
import {
  logSection,
  logGame,
  logTx,
  logPdas,
  PdaEntry,
  bidPhrase,
  diceStr,
} from "./helpers/log";
import {
  getHostSessionKeypair,
  getPlayerBSessionKeypair,
} from "./helpers/session";
import * as ix from "./helpers/instructions";

dotenv.config();

describe("liar-dice: reveal stall -> settle_round slashes non-revealer", function () {
  this.timeout(180_000);

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
  const sessionManager = new SessionTokenManager(wallet, connection);
  const router = routerConnection();

  // Shared TEE connection for PUBLIC game reads only.
  let publicGame: Program<LiarDice>;

  const gameId = new BN(Date.now());
  const entryFee = new BN(0.001 * LAMPORTS_PER_SOL);
  const GRACE_SECONDS = 6; // short so the test doesn't wait long
  const hostWallet = keypairFromEnv("HOST_KEY");
  const bWallet = keypairFromEnv("PLAYER_B_KEY"); // the staller

  const game = gamePda(program.programId, hostWallet.publicKey, gameId);
  const vault = vaultPda(program.programId, game);

  const sp = sessionManager.program.programId;
  const host = makePlayer(program, game, "host", hostWallet, getHostSessionKeypair(), sp);
  const playerB = makePlayer(program, game, "playerB", bWallet, getPlayerBSessionKeypair(), sp);
  const players = [host, playerB];

  const allPdas = (): PdaEntry[] => [
    { label: "game", pubkey: game },
    { label: "vault", pubkey: vault },
    { label: "programIdentity", pubkey: programIdentityPda(program.programId) },
    ...players.flatMap((p) => [
      { label: `hand (${p.label})`, pubkey: p.hand },
      { label: `permission (${p.label})`, pubkey: permissionPda(p.hand) },
      { label: `session (${p.label})`, pubkey: p.sessionToken },
    ]),
  ];

  before(async function () {
    console.log("Program ID:", program.programId.toBase58());
    console.log("Game PDA: ", game.toBase58());
    for (const p of players) {
      console.log(`   ${p.label} wallet   ${p.wallet.publicKey.toBase58()}`);
      console.log(`   ${p.label} session  ${p.session.publicKey.toBase58()}`);
    }
    await logPdas(connection, "initial state (devnet)", allPdas());

    for (const p of players)
      await fundKeypair(connection, wallet, p.wallet.publicKey, 2);

    // Base layer: create -> join x2 -> start.
    logSection("setup: create -> join -> start (base layer)");
    logTx(
      "create_game",
      await sendBuilt(
        connection,
        await ix.buildCreateGame(program, {
          host: host.wallet,
          game,
          gameId,
          entryFee,
          graceSeconds: GRACE_SECONDS,
        })
      )
    );
    for (const p of players) {
      const sig = await sendBuilt(
        connection,
        await ix.buildJoinGame(program, {
          player: p.wallet,
          game,
          vault,
          playerHand: p.hand,
        })
      );
      logTx(`join_game (${p.label})`, sig);
    }
    logTx(
      "start_game",
      await sendBuilt(
        connection,
        await ix.buildStartGame(program, { host: host.wallet, game })
      )
    );

    // Enter ER: each player delegates + mints their session key in one tx.
    logSection("setup: delegate + session + permissions (ER)");
    const validator = await teeValidator();
    for (const p of players) {
      const built = await ix.buildDelegateAndSession(
        program,
        sessionManager,
        connection,
        {
          player: p.wallet,
          sessionSigner: p.session,
          host: host.wallet.publicKey,
          game,
          gameId,
          playerHand: p.hand,
          validatorIdentity: validator.identity,
        }
      );
      logTx(`delegate + session (${p.label})`, await sendBuilt(connection, built));
    }

    await sleep(2000);
    if (!(await router.getDelegationStatus(game)).isDelegated)
      throw new Error("Router does not report the game as delegated");

    // Each player gets their own private TEE connection; publicGame reads shared state.
    publicGame = await connectToTee(program, wallet, validator.fqdn, players);

    // Make each hand private on the ER.
    for (const p of players) {
      const sig = await sendTee(
        p,
        await ix.buildInitHandPermission(program, {
          player: p.wallet,
          playerHand: p.hand,
          permission: permissionPda(p.hand),
        })
      );
      logTx(`init_hand_permission (${p.label})`, sig, true);
    }
  });

  it("keeps hands private: owner CAN read own hand, others CANNOT", async () => {
    logSection("privacy read-matrix (reader token → hand)");
    await assertHandsPrivate(players);
  });

  it("slashes a non-revealer and still settles the bid", async () => {
    let clientSeed = 1;

    // Both players roll for round 1 on their own TEE connections.
    logSection("round 1: rolls");
    for (const p of players) {
      const sig = await sendTee(
        p,
        await ix.buildRequestRoll(program, sessionCtx(p), {
          game,
          playerHand: p.hand,
          clientSeed: clientSeed++,
        })
      );
      logTx(`request_roll (${p.label})`, sig, true);
      await waitForRoll(p.tee!, p.hand);
    }

    // Each player reads ONLY their own dice via their own token.
    console.log("- Rolls (each hand private to its owner until reveal):");
    for (const p of players) {
      const h = await p.tee!.account.playerHand.fetch(p.hand);
      console.log(
        `   🔒 ${p.label} sees own dice: ${diceStr(h.dice, h.diceCount)} (hidden from others)`
      );
    }

    // Host is the starter: one tx bundles begin_bidding + a true bid; playerB challenges.
    logSection("host bids (begin_bidding + bid), playerB challenges");
    const hostHand = await host.tee!.account.playerHand.fetch(host.hand);
    const bidFace = hostHand.dice[0];
    const bidSig = await sendTee(
      host,
      await ix.buildBeginBiddingAndBid(program, sessionCtx(host), {
        game,
        playerHand: host.hand,
        quantity: 1,
        face: bidFace,
        hands: players.map((p) => p.hand),
      })
    );
    console.log(`- host bids "${bidPhrase(1, bidFace)}"  (begin_bidding + bid)  ${bidSig}`);
    const chSig = await sendTee(
      playerB,
      await ix.buildChallenge(program, sessionCtx(playerB), { game })
    );
    console.log(`- playerB calls liar on host's "${bidPhrase(1, bidFace)}"   ${chSig}`);

    // Host reveals; playerB deliberately does NOT (the stall).
    logSection("host reveals, playerB stalls");
    const revealSig = await sendTee(
      host,
      await ix.buildReveal(program, sessionCtx(host), { game, playerHand: host.hand })
    );
    logTx("reveal (host)", revealSig, true);

    // Only host is in the public reveal table; playerB's dice stay private.
    const afterReveal = await publicGame.account.game.fetch(game);
    const revealStrs = afterReveal.lastReveal.map((r) => {
      const label = players[r.playerIdx]?.label ?? `seat ${r.playerIdx}`;
      return `${label} = ${diceStr(r.dice, r.diceCount)}`;
    });
    console.log(`- 📖 Reveal (now public): ${revealStrs.join(", ") || "(none)"}`);
    console.log("   🔒 playerB never revealed — its dice remain private on the TEE");

    // Can't settle yet — playerB hasn't revealed.
    const stalled = await publicGame.account.game.fetch(game);
    assert.strictEqual(
      JSON.stringify(stalled.phase),
      JSON.stringify({ revealing: {} }),
      "should be in the reveal phase"
    );
    assert.strictEqual(stalled.lastReveal.length, 1, "only host revealed");
    const diceBefore = stalled.diceCounts.map((d: number) => d);
    assert.strictEqual(diceBefore[0], diceBefore[1], "both start with equal dice");

    // Wait out the deadline, then anyone settles (host's session key here, no popup).
    // Past the deadline playerB (non-revealer + losing challenger) drops two dice.
    logSection(`waiting out the ${GRACE_SECONDS}s deadline`);
    const deadline = stalled.actionDeadline.toNumber();
    while (Math.floor(Date.now() / 1000) <= deadline + 1) await sleep(1000);

    const sig = await sendTee(
      host,
      await ix.buildSettleRound(program, sessionCtx(host), { game }),
      { printLogs: true }
    );
    logTx("settle_round (via session key, past deadline)", sig, true);

    await logGame(publicGame, game, "after settle_round");
    const settled = await publicGame.account.game.fetch(game);

    // Game continues → next round reopens in the Rolling phase.
    assert.strictEqual(
      JSON.stringify(settled.phase),
      JSON.stringify({ rolling: {} }),
      "reveal phase cleared; next round is rolling"
    );
    assert.strictEqual(settled.diceCounts[0], diceBefore[0], "host revealed, keeps all dice");
    assert.strictEqual(
      settled.diceCounts[1],
      diceBefore[1] - 2,
      "non-revealing challenger loses two dice"
    );
    assert.strictEqual(settled.isActive[0], true, "host still active");
    assert.strictEqual(settled.isActive[1], true, "playerB still active");
    assert.strictEqual(
      JSON.stringify(settled.status),
      JSON.stringify({ active: {} }),
      "game continues (nobody eliminated)"
    );
    assert.strictEqual(settled.round, stalled.round + 1, "round advances after settlement");
  });
});
