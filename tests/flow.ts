// Full success flow: base setup -> enter ER -> play rounds on TEE -> pay winner.
// Two named players (host, playerB); `players` is just [host, playerB] for loops.
// Needs live devnet + MagicBlock router + VRF oracle. Run via `yarn test:flow`.
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import dotenv from "dotenv";
import { LiarDice } from "../target/types/liar_dice";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import {
  gamePda,
  vaultPda,
  programIdentityPda,
  permissionPda,
  keypairFromEnvOrGenerate,
} from "./helpers/accounts";
import {
  routerConnection,
  teeValidator,
  fundKeypair,
  sendBuilt,
  sleep,
  waitForRoll,
  waitUntilOwnedBy,
  waitUntilClosed,
} from "./helpers/connections";
import {
  Player,
  makePlayer,
  sessionCtx,
  sendTee,
  connectToTee,
} from "./helpers/player";
import {
  logSection,
  logGame,
  logBalances,
  logTx,
  logPdas,
  PdaEntry,
  bidPhrase,
  faceWord,
  diceStr,
  scoreLine,
} from "./helpers/log";
import {
  getHostSessionKeypair,
  getPlayerBSessionKeypair,
} from "./helpers/session";
import {
  HandView,
  BidView,
  countFace,
  trueBidsAscending,
  bluffBid,
} from "./helpers/bidding";
import * as ix from "./helpers/instructions";

dotenv.config();

describe("liar-dice: full success flow", function () {
  this.timeout(300_000);

  // Base-layer provider (devnet). Wallet.local() loads ANCHOR_WALLET / id.json.
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

  // Shared TEE connection for PUBLIC game reads only; private hands use each player's own `p.tee`.
  let publicGame: Program<LiarDice>;

  const gameId = new BN(Date.now());
  const entryFee = new BN(0.001 * LAMPORTS_PER_SOL);
  // Falls back to a freshly generated + persisted keypair if unset (see
  // `keypairFromEnvOrGenerate`); `fundKeypair` below tops it up from `wallet` either way.
  const hostWallet = keypairFromEnvOrGenerate("HOST_KEY");
  const bWallet = keypairFromEnvOrGenerate("PLAYER_B_KEY");

  const game = gamePda(program.programId, hostWallet.publicKey, gameId);
  const vault = vaultPda(program.programId, game);

  // The two players. `host` also owns/starts the game. Session keys persist to .env.
  const sp = sessionManager.program.programId;
  const host = makePlayer(
    program,
    game,
    "host",
    hostWallet,
    getHostSessionKeypair(),
    sp
  );
  const playerB = makePlayer(
    program,
    game,
    "playerB",
    bWallet,
    getPlayerBSessionKeypair(),
    sp
  );
  const players = [host, playerB];

  // Every PDA this flow touches, for the on-chain snapshot log.
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

    for (const p of players)
      await fundKeypair(connection, wallet, p.wallet.publicKey, 2);
    await logBalances(connection, "before game (devnet)", [
      ...players.map((p) => ({ label: p.label, pubkey: p.wallet.publicKey })),
      { label: "vault", pubkey: vault },
    ]);
    await logPdas(connection, "initial state (devnet)", allPdas());
  });

  // ── Phase A — base-layer setup ────────────────────────────────────────────

  it("creates the game (Waiting, empty roster)", async () => {
    logSection("create_game");
    const sig = await sendBuilt(
      connection,
      await ix.buildCreateGame(program, {
        host: host.wallet,
        game,
        gameId,
        entryFee,
        graceSeconds: 30,
      })
    );
    logTx("create_game", sig);
    await logGame(program, game, "after create_game");
  });

  it("both players join and pay the entry fee into the vault", async () => {
    logSection("join_game x2");
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
    await logGame(program, game, "after both joins");
    await logBalances(connection, "after joins (devnet)", [
      ...players.map((p) => ({ label: p.label, pubkey: p.wallet.publicKey })),
      { label: "vault", pubkey: vault },
    ]);
  });

  it("starts the game (Waiting -> Active)", async () => {
    logSection("start_game");
    const sig = await sendBuilt(
      connection,
      await ix.buildStartGame(program, { host: host.wallet, game })
    );
    logTx("start_game", sig);
    await logGame(program, game, "after start_game");
  });

  // ── Phase B — enter the Ephemeral Rollup ──────────────────────────────────

  it("each player enters the ER: delegate hand + create session in ONE tx", async () => {
    logSection("delegate + create_session (single tx per player)");
    const validator = await teeValidator();
    console.log("TEE validator:", validator.identity.toBase58());

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
      logTx(
        `delegate + session (${p.label})`,
        await sendBuilt(connection, built)
      );
    }

    // Confirm the game is delegated, then wire up TEE connections.
    await sleep(2000);
    const status = await router.getDelegationStatus(game);
    if (!status.isDelegated)
      throw new Error("Router does not report the game as delegated");

    // Each player gets their own private TEE connection; publicGame reads shared state.
    publicGame = await connectToTee(program, wallet, validator.fqdn, players);
    console.log("ER endpoint (TEE, authed):", validator.fqdn);
  });

  it("makes each hand private on the ER (owner-only permission)", async () => {
    logSection("init_hand_permission");
    for (const p of players) {
      // Sent over this player's own TEE connection.
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

  // Can `reader`'s own TEE token fetch the account at `hand`?
  // Read a hand through `reader`'s own token; returns the dice, or null if denied.
  const readHand = async (reader: Player, hand: anchor.web3.PublicKey) => {
    try {
      return await reader.tee!.account.playerHand.fetch(hand);
    } catch {
      return null;
    }
  };

  // ── Privacy: a hand is readable ONLY through its owner's own token. ─────────

  it("privacy: host CAN read host's own hand", async () => {
    logSection("privacy: host token → host's hand");
    const h = await readHand(host, host.hand);
    if (!h) throw new Error("owner (host) could not read their own hand");
    console.log(
      `   ✓  host token → host's hand: READABLE ${diceStr(h.dice, h.diceCount)}`
    );
  });

  it("privacy: playerB CAN read playerB's own hand", async () => {
    logSection("privacy: playerB token → playerB's hand");
    const h = await readHand(playerB, playerB.hand);
    if (!h) throw new Error("owner (playerB) could not read their own hand");
    console.log(
      `   ✓  playerB token → playerB's hand: READABLE ${diceStr(
        h.dice,
        h.diceCount
      )}`
    );
  });

  it("privacy: host CANNOT read playerB's hand", async () => {
    logSection("privacy: host token → playerB's hand");
    const h = await readHand(host, playerB.hand);
    if (h) throw new Error("PRIVACY BROKEN: host read playerB's hand");
    console.log("   ✓  host token → playerB's hand: denied");
  });

  it("privacy: playerB CANNOT read host's hand", async () => {
    logSection("privacy: playerB token → host's hand");
    const h = await readHand(playerB, host.hand);
    if (h) throw new Error("PRIVACY BROKEN: playerB read host's hand");
    console.log("   ✓  playerB token → host's hand: denied");
  });

  // ── Phase C — play rounds on the ER until one player is eliminated ─────────

  it("plays rounds (roll -> bid -> challenge -> reveal -> settle) until Ended", async () => {
    let clientSeed = 1;
    const MAX_ROUNDS = 25;
    for (let iteration = 0; iteration < MAX_ROUNDS; iteration++) {
      const g = await publicGame.account.game.fetch(game);
      if (JSON.stringify(g.status) === JSON.stringify({ ended: {} })) break;

      const round = g.round;
      const diceBefore = [...g.diceCounts];
      const activePlayers = players.filter((_, i) => g.isActive[i]);
      logSection(`Round ${round} — start: ${scoreLine(players, diceBefore)}`);

      // request_roll — signed by each player's SESSION KEY (no wallet popup); VRF dice on their own TEE conn.
      for (const p of activePlayers) {
        const before = await p.tee!.account.playerHand.fetch(p.hand);
        if (before.rolledRound >= round) continue; // already rolled this round
        const sig = await sendTee(
          p,
          await ix.buildRequestRoll(program, sessionCtx(p), {
            game,
            playerHand: p.hand,
            clientSeed: clientSeed++,
          })
        );
        await waitForRoll(p.tee!, p.hand);
        logTx(`request_roll (${p.label})`, sig, true);
      }

      // Each player reads ONLY their own dice via their own token (their private screen).
      console.log("- Rolls (each hand private to its owner until reveal):");
      const hands: HandView[] = [];
      for (const p of activePlayers) {
        const h = await p.tee!.account.playerHand.fetch(p.hand);
        hands.push({ dice: h.dice, diceCount: h.diceCount });
        console.log(
          `   🔒 ${p.label} sees own dice: ${diceStr(
            h.dice,
            h.diceCount
          )} (hidden from others)`
        );
      }

      // The first bid is the starter's one-tap begin_bidding+bid; later bids are plain.
      const bids: (BidView & { label: string })[] = [];
      let biddingOpened = false;
      async function bid(quantity: number, face: number): Promise<void> {
        const gg = await publicGame.account.game.fetch(game);
        if (!biddingOpened) {
          // Last round's loser leads; if they're out, the next active seat leads.
          let starterIdx = gg.lastLoser;
          if (!gg.isActive[starterIdx]) {
            let i = (starterIdx + 1) % players.length;
            while (!gg.isActive[i]) i = (i + 1) % players.length;
            starterIdx = i;
          }
          const starter = players[starterIdx];
          const sig = await sendTee(
            starter,
            await ix.buildBeginBiddingAndBid(program, sessionCtx(starter), {
              game,
              playerHand: starter.hand,
              quantity,
              face,
              hands: activePlayers.map((p) => p.hand),
            })
          );
          biddingOpened = true;
          bids.push({ label: starter.label, quantity, face });
          console.log(
            `   - ${starter.label}: "${bidPhrase(
              quantity,
              face
            )}"  (begin_bidding + bid)  ${sig}`
          );
          return;
        }
        // place_bid — signed by the bidder's SESSION KEY.
        const bidder = players[gg.currentTurn];
        const sig = await sendTee(
          bidder,
          await ix.buildPlaceBid(program, sessionCtx(bidder), {
            game,
            playerHand: bidder.hand,
            quantity,
            face,
          })
        );
        bids.push({ label: bidder.label, quantity, face });
        console.log(
          `   - ${bidder.label}: "${bidPhrase(quantity, face)}"   ${sig}`
        );
      }

      // A different bidding scenario each round, to exercise more code paths.
      const totalDice = hands.reduce((n, h) => n + h.diceCount, 0);
      const trueBids = trueBidsAscending(hands, totalDice);
      const scenario = round % 4;
      const scenarioName = [
        "safe single true bid",
        "raise chain (all true)",
        "early bluff",
        "raise chain, then bluff on top",
      ][scenario];
      console.log(`- Bidding (${scenarioName}):`);

      if (scenario === 0) {
        await bid(trueBids[0].quantity, trueBids[0].face);
      } else if (scenario === 1) {
        for (const b of trueBids.slice(0, Math.min(3, trueBids.length)))
          await bid(b.quantity, b.face);
      } else if (scenario === 2) {
        const bluff = bluffBid(hands, totalDice);
        await bid(bluff.quantity, bluff.face);
      } else {
        const chain = trueBids.slice(0, Math.min(2, trueBids.length));
        for (const b of chain) await bid(b.quantity, b.face);
        const last = chain[chain.length - 1];
        const bluff = bluffBid(hands, totalDice, last);
        if (bluff.quantity > last.quantity)
          await bid(bluff.quantity, bluff.face);
        else
          console.log(
            "   (bluff can't out-rank; leaving true bid to challenge)"
          );
      }

      // challenge — signed by the challenger's SESSION KEY; whoever holds the turn calls liar.
      const standing = bids[bids.length - 1];
      const gc = await publicGame.account.game.fetch(game);
      const challenger = players[gc.currentTurn];
      const chSig = await sendTee(
        challenger,
        await ix.buildChallenge(program, sessionCtx(challenger), { game })
      );
      console.log(
        `- ${challenger.label} calls liar on ${standing.label}'s "${bidPhrase(
          standing.quantity,
          standing.face
        )}".   ${chSig}`
      );

      // Reveal: each player opens their own hand into the PUBLIC table (dice go public here).
      for (const p of activePlayers) {
        const sig = await sendTee(
          p,
          await ix.buildReveal(program, sessionCtx(p), {
            game,
            playerHand: p.hand,
          })
        );
        logTx(`reveal (${p.label})`, sig, true);
      }

      // Read the now-public reveal table (no private access needed).
      const revealedGame = await publicGame.account.game.fetch(game);
      const revealStrs = revealedGame.lastReveal.map((r) => {
        const label = players[r.playerIdx]?.label ?? `seat ${r.playerIdx}`;
        return `${label} = ${diceStr(r.dice, r.diceCount)}`;
      });
      console.log(`- 📖 Reveal (now public): ${revealStrs.join(", ")}`);

      // settle_round — signed by the host's SESSION KEY; scores the bid and slashes the loser.
      const stSig = await sendTee(
        host,
        await ix.buildSettleRound(program, sessionCtx(host), { game })
      );
      const settled = await publicGame.account.game.fetch(game);

      // Count the challenged face (1s wild unless face===1) and report the result.
      const face = standing.face;
      const perSeat = activePlayers
        .map((p, i) => `${p.label} has ${countFace([hands[i]], face)}`)
        .join(", ");
      const actual = countFace(hands, face);
      const held = actual >= standing.quantity;
      console.log(
        `- Reveal & count ${faceWord(
          face
        )}s: ${perSeat} → actual = ${actual}. ` +
          `Bid needed ${standing.quantity} → ${
            held ? "TRUE" : "BLUFF"
          }.   ${stSig}`
      );

      players.forEach((p, i) => {
        const lost = diceBefore[i] - settled.diceCounts[i];
        if (lost > 0)
          console.log(
            `- ${p.label} loses ${lost} ${lost === 1 ? "die" : "dice"}.`
          );
      });
      console.log(`➡️  Score: ${scoreLine(players, [...settled.diceCounts])}`);
    }

    const finalGame = await publicGame.account.game.fetch(game);
    console.log("Final status:", JSON.stringify(finalGame.status));

    // Simple per-player summary.
    logSection("per-player summary");
    players.forEach((p, i) => {
      const state = finalGame.isActive[i] ? "still in" : "eliminated";
      console.log(
        `   ${p.label}: ${
          finalGame.diceCounts[i]
        } dice (${state})  wallet ${p.wallet.publicKey.toBase58()}`
      );
    });

    if (JSON.stringify(finalGame.status) !== JSON.stringify({ ended: {} }))
      throw new Error(`Game did not reach Ended within ${MAX_ROUNDS} rounds`);
  });

  // ── Phase D — atomic commit + undelegate + payout ─────────────────────────

  it("closes the winner's hand permission before end_game undelegates it", async () => {
    logSection("close_hand_permission: reclaim rent while still on the ER");
    const g = await publicGame.account.game.fetch(game);
    const winnerIdx = g.isActive.findIndex((a) => a);
    const winner = players[winnerIdx];
    if (!winner)
      throw new Error("Could not resolve the winning player for this test");

    const permission = permissionPda(winner.hand);
    const before = await winner.tee!.provider.connection.getAccountInfo(
      permission
    );
    if (!before)
      throw new Error(
        "Expected the winner's permission to exist before closing it"
      );

    const sig = await sendTee(
      winner,
      await ix.buildCloseHandPermission(program, {
        player: winner.wallet,
        playerHand: winner.hand,
        permission,
      })
    );
    logTx(`close_hand_permission (${winner.label})`, sig, true);
  });

  it("ends the game: commits + undelegates and pays out atomically", async () => {
    logSection("end_game: ER (delegated) -> base (committed + paid out)");
    const g = await publicGame.account.game.fetch(game);
    const winnerIdx = g.isActive.findIndex((a) => a);
    const winner = g.players[winnerIdx];
    const winnerLabel = players[winnerIdx]?.label ?? `seat ${winnerIdx}`;
    console.log(`🏆 ${winnerLabel.toUpperCase()} WINS — ${winner.toBase58()}`);

    const winnerBefore = await connection.getBalance(winner);
    await logBalances(connection, "before payout (devnet)", [
      { label: "winner", pubkey: winner },
      { label: "vault", pubkey: vault },
    ]);

    // Fund host's escrow so the post-commit payout Magic Action has fees.
    const { ix: topUpIx, escrowPda } = ix.buildTopUpEscrow({
      escrowAuthority: host.wallet,
      lamports: 0.005 * LAMPORTS_PER_SOL,
    });
    const topUpSig = await sendBuilt(connection, {
      tx: new anchor.web3.Transaction().add(topUpIx),
      signers: [host.wallet],
    });
    logTx(`top_up_escrow (${escrowPda.toBase58().slice(0, 8)})`, topUpSig);

    // end_game on the ER: commits + undelegates game and both hands, pays winner.
    const sig = await sendTee(
      host,
      await ix.buildEndGame(program, {
        caller: host.wallet,
        game,
        vault,
        winner,
        handAccounts: players.map((p) => p.hand),
      })
    );
    logTx("end_game", sig, true);

    // Wait for the commit + payout to land on base layer.
    if (!(await waitUntilOwnedBy(connection, game, program.programId)))
      throw new Error("Game did not commit back to base layer in time");

    await logGame(program, game, "after commit (base layer)");
    await logBalances(connection, "after payout (devnet)", [
      { label: "winner", pubkey: winner },
      ...players.map((p) => ({ label: p.label, pubkey: p.wallet.publicKey })),
      { label: "vault", pubkey: vault },
    ]);
    const deltaSol =
      ((await connection.getBalance(winner)) - winnerBefore) / LAMPORTS_PER_SOL;
    const potSol = g.potLamports.toNumber() / LAMPORTS_PER_SOL;
    console.log(
      `- Payout: pot ${potSol.toFixed(9)} SOL → ${winnerLabel} ` +
        `(balance +${deltaSol.toFixed(9)} SOL, incl. reclaimed rent).`
    );

    // Hands were undelegated in end_game's commit — reclaim their rent on base.
    logSection("close_hand: reclaim each hand's rent");
    for (const p of players) {
      // Wait until the hand is owned by our program again (undelegated).
      await waitUntilOwnedBy(connection, p.hand, program.programId);
      const sig = await sendBuilt(
        connection,
        await ix.buildCloseHand(program, {
          caller: host.wallet, // anyone can trigger; rent goes to the owner
          game,
          player: p.wallet.publicKey,
          playerHand: p.hand,
        })
      );
      logTx(`close_hand (${p.label})`, sig);
      const info = await connection.getAccountInfo(p.hand);
      if (info) throw new Error(`hand ${p.label} was not closed`);
    }
  });
});
