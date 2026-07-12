/**
 * One instruction-builder per game action. Each returns an unsigned `Transaction`
 * plus the `signers` it needs, so the SAME builders drive both these tests and a
 * future UI (the UI just swaps `signers` for a wallet adapter and picks the base
 * or ER connection when it sends). No logging or sending happens here.
 *
 * Which connection each built tx must be sent on:
 *   base layer → createGame, joinGame, startGame, delegateAndSession, topUpEscrow
 *   ephemeral  → initHandPermission, requestRoll, placeBid, challenge, reveal,
 *                settleRound, endGame
 */
import { Program, BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import {
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  PERMISSION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  escrowPdaFromEscrowAuthority,
  createTopUpEscrowInstruction,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { LiarDice } from "../../target/types/liar_dice";
import { handPda, sessionTokenPda } from "./accounts";

const SYSTEM_PROGRAM = anchor.web3.SystemProgram.programId;

/** Every builder returns an unsigned tx plus the keypairs that must sign it. */
export type Built = { tx: Transaction; signers: Keypair[] };

// ── Phase A: base-layer setup ───────────────────────────────────────────────

/** Host opens a new game in `Waiting` with an empty roster. */
export async function buildCreateGame(
  program: Program<LiarDice>,
  args: {
    host: Keypair;
    game: PublicKey;
    gameId: BN;
    entryFee: BN;
    graceSeconds: number;
  }
): Promise<Built> {
  const tx = await program.methods
    .createGame(args.gameId, args.entryFee, new BN(args.graceSeconds))
    .accountsPartial({
      host: args.host.publicKey,
      game: args.game,
      systemProgram: SYSTEM_PROGRAM,
    })
    .transaction();
  return { tx, signers: [args.host] };
}

/** A player joins: pays the entry fee into the vault and creates their hand PDA. */
export async function buildJoinGame(
  program: Program<LiarDice>,
  args: {
    player: Keypair;
    game: PublicKey;
    vault: PublicKey;
    playerHand: PublicKey;
  }
): Promise<Built> {
  const tx = await program.methods
    .joinGame()
    .accountsPartial({
      player: args.player.publicKey,
      game: args.game,
      vault: args.vault,
      playerHand: args.playerHand,
      systemProgram: SYSTEM_PROGRAM,
    })
    .transaction();
  return { tx, signers: [args.player] };
}

/** Host starts the game (`Waiting` -> `Active`). Must run before any delegation. */
export async function buildStartGame(
  program: Program<LiarDice>,
  args: { host: Keypair; game: PublicKey }
): Promise<Built> {
  const tx = await program.methods
    .startGame()
    .accountsPartial({ host: args.host.publicKey, game: args.game })
    .transaction();
  return { tx, signers: [args.host] };
}

/**
 * Host-only: cancel a still-`Waiting` game, refund every player's entry fee, and close
 * their hand PDAs (reclaiming rent). Remaining accounts are [wallet, hand] pairs in
 * game.players order — the builder derives each hand PDA from the player wallet.
 */
export async function buildCancelGame(
  program: Program<LiarDice>,
  args: {
    host: Keypair;
    game: PublicKey;
    vault: PublicKey;
    players: PublicKey[];
  }
): Promise<Built> {
  const tx = await program.methods
    .cancelGame()
    .accountsPartial({
      host: args.host.publicKey,
      game: args.game,
      vault: args.vault,
      systemProgram: SYSTEM_PROGRAM,
    })
    .remainingAccounts(
      args.players.flatMap((wallet) => [
        { pubkey: wallet, isSigner: false, isWritable: true },
        {
          pubkey: handPda(program.programId, args.game, wallet),
          isSigner: false,
          isWritable: true,
        },
      ])
    )
    .transaction();
  return { tx, signers: [args.host] };
}

// ── Phase B: enter the rollup (one wallet approval per player) ───────────────

/**
 * ONE base-layer tx that both delegates this player's hand (+ the shared game, the
 * first caller only) to the ER and creates their gameplay session key. This is the
 * "enter the rollup" step: a single approval that hands state to the ER and mints
 * the ephemeral signer used for the rest of the game.
 *
 * Idempotent: on-chain `delegate` skips already-delegated accounts, and we drop the
 * session instruction if that token already exists (persisted key from a prior run).
 * The returned `sessionToken` is the PDA gameplay builders sign against.
 */
export async function buildDelegateAndSession(
  program: Program<LiarDice>,
  sessionManager: SessionTokenManager,
  baseConnection: Connection,
  args: {
    player: Keypair;
    sessionSigner: Keypair;
    host: PublicKey;
    game: PublicKey;
    gameId: BN;
    playerHand: PublicKey;
    validatorIdentity: PublicKey;
    sessionTtlSeconds?: number;
    sessionTopUpLamports?: number;
  }
): Promise<Built & { sessionToken: PublicKey }> {
  const tx = new Transaction();
  const signers: Keypair[] = [args.player];

  // delegate_game is host-only, so only the host bundles it; everyone delegates their own hand.
  const delegateHandIx = await program.methods
    .delegateHand(args.gameId)
    .accountsPartial({
      player: args.player.publicKey,
      host: args.host,
      game: args.game,
      playerHand: args.playerHand,
      validator: args.validatorIdentity,
    })
    .instruction();
  if (args.player.publicKey.equals(args.host)) {
    const delegateGameIx = await program.methods
      .delegateGame(args.gameId)
      .accountsPartial({
        payer: args.player.publicKey,
        host: args.host,
        game: args.game,
        validator: args.validatorIdentity,
      })
      .instruction();
    tx.add(delegateGameIx, delegateHandIx);
  } else {
    tx.add(delegateHandIx);
  }

  const sessionToken = sessionTokenPda(
    program.programId,
    args.sessionSigner.publicKey,
    args.player.publicKey,
    sessionManager.program.programId
  );

  // Only mint the session token if it doesn't already exist.
  if (!(await baseConnection.getAccountInfo(sessionToken))) {
    const ttl = args.sessionTtlSeconds ?? 3600;
    const topUp = args.sessionTopUpLamports ?? 0.005 * LAMPORTS_PER_SOL;
    const sessionIx = await sessionManager.program.methods
      .createSessionV2(
        true,
        new BN(Math.floor(Date.now() / 1000) + ttl),
        new BN(topUp)
      )
      .accounts({
        targetProgram: program.programId,
        sessionSigner: args.sessionSigner.publicKey,
        feePayer: args.player.publicKey,
        authority: args.player.publicKey,
      })
      .instruction();
    tx.add(sessionIx);
    signers.push(args.sessionSigner); // the granted key must co-sign its own creation
  }

  return { tx, signers, sessionToken };
}

/** Make a hand private on the ER: owner-only permission gate. */
export async function buildInitHandPermission(
  program: Program<LiarDice>,
  args: { player: Keypair; playerHand: PublicKey; permission: PublicKey }
): Promise<Built> {
  const tx = await program.methods
    .initHandPermission()
    .accountsPartial({
      signer: args.player.publicKey,
      authority: args.player.publicKey,
      sessionToken: null,
      playerHand: args.playerHand,
      permission: args.permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .transaction();
  return { tx, signers: [args.player] };
}

/** Close a hand's permission on the ER, refunding its rent. Must run BEFORE
 *  the hand is undelegated (end_game) — the permission is unreachable after. */
export async function buildCloseHandPermission(
  program: Program<LiarDice>,
  args: { player: Keypair; playerHand: PublicKey; permission: PublicKey }
): Promise<Built> {
  const tx = await program.methods
    .closeHandPermission()
    .accountsPartial({
      signer: args.player.publicKey,
      authority: args.player.publicKey,
      sessionToken: null,
      playerHand: args.playerHand,
      permission: args.permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .transaction();
  return { tx, signers: [args.player] };
}

// ── Phase C: gameplay on the ER (all session-signed) ────────────────────────

/** Fields shared by every session-signed gameplay action. */
type SessionCtx = {
  sessionSigner: Keypair;
  authority: PublicKey;
  sessionToken: PublicKey;
};

/** Request fresh VRF dice for the caller's hand this round. */
export async function buildRequestRoll(
  program: Program<LiarDice>,
  s: SessionCtx,
  args: { game: PublicKey; playerHand: PublicKey; clientSeed: number }
): Promise<Built> {
  const tx = await program.methods
    .requestRoll(args.clientSeed)
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: args.game,
      playerHand: args.playerHand,
    })
    .transaction();
  return { tx, signers: [s.sessionSigner] };
}

/**
 * Close the shared roll window and open bidding (permissionless). Pass EVERY active
 * player's hand in `hands` so the on-chain roll check is honest. Succeeds immediately
 * once all rolled, or past the roll deadline (skipping/striking the no-shows).
 */
export async function buildBeginBidding(
  program: Program<LiarDice>,
  args: { caller: Keypair; game: PublicKey; hands: PublicKey[] }
): Promise<Built> {
  const tx = await program.methods
    .beginBidding()
    .accountsPartial({ caller: args.caller.publicKey, game: args.game })
    .remainingAccounts(
      args.hands.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      }))
    )
    .transaction();
  return { tx, signers: [args.caller] };
}

/** Place (or raise to) a bid of `quantity` dice showing `face`. */
export async function buildPlaceBid(
  program: Program<LiarDice>,
  s: SessionCtx,
  args: {
    game: PublicKey;
    playerHand: PublicKey;
    quantity: number;
    face: number;
  }
): Promise<Built> {
  const tx = await program.methods
    .placeBid(args.quantity, args.face)
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: args.game,
      playerHand: args.playerHand,
    })
    .transaction();
  return { tx, signers: [s.sessionSigner] };
}

/**
 * The STARTER's one-tap first move: `begin_bidding` + `place_bid` in a single tx.
 * `s` must be the starter's session context (the seat that leads the round —
 * `begin_bidding` opens bidding on them, and `place_bid` requires it's their turn).
 * Everyone after the first bid uses plain `buildPlaceBid` / `buildChallenge`.
 */
export async function buildBeginBiddingAndBid(
  program: Program<LiarDice>,
  s: SessionCtx,
  args: {
    game: PublicKey;
    playerHand: PublicKey;
    quantity: number;
    face: number;
    hands: PublicKey[]; // every active player's hand, for begin_bidding
  }
): Promise<Built> {
  const beginIx = await program.methods
    .beginBidding()
    .accountsPartial({ caller: s.sessionSigner.publicKey, game: args.game })
    .remainingAccounts(
      args.hands.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      }))
    )
    .instruction();
  const bidIx = await program.methods
    .placeBid(args.quantity, args.face)
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: args.game,
      playerHand: args.playerHand,
    })
    .instruction();
  const tx = new Transaction().add(beginIx).add(bidIx);
  return { tx, signers: [s.sessionSigner] };
}

/** Challenge the standing bid, opening the reveal phase. */
export async function buildChallenge(
  program: Program<LiarDice>,
  s: SessionCtx,
  args: { game: PublicKey }
): Promise<Built> {
  const tx = await program.methods
    .challenge()
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: args.game,
    })
    .transaction();
  return { tx, signers: [s.sessionSigner] };
}

/** Reveal the caller's hand so the challenged bid can be scored. */
export async function buildReveal(
  program: Program<LiarDice>,
  s: SessionCtx,
  args: { game: PublicKey; playerHand: PublicKey }
): Promise<Built> {
  const tx = await program.methods
    .reveal()
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: args.game,
      playerHand: args.playerHand,
    })
    .transaction();
  return { tx, signers: [s.sessionSigner] };
}

/**
 * Force out the `target` player once they stall past the deadline on their turn
 * (e.g. never rolled). Permissionless — any signer or session key may fire it.
 */
export async function buildForceTimeout(
  program: Program<LiarDice>,
  s: SessionCtx,
  args: { game: PublicKey; target: PublicKey }
): Promise<Built> {
  const tx = await program.methods
    .forceTimeout(args.target)
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: args.game,
    })
    .transaction();
  return { tx, signers: [s.sessionSigner] };
}

/**
 * Settle the round (permissionless). Slashes non-revealers past the deadline and
 * scores the bid. Signed by a session key acting for its authority.
 */
export async function buildSettleRound(
  program: Program<LiarDice>,
  s: SessionCtx,
  args: { game: PublicKey }
): Promise<Built> {
  const tx = await program.methods
    .settleRound()
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: args.game,
    })
    .transaction();
  return { tx, signers: [s.sessionSigner] };
}

// ── Phase D: end + payout ───────────────────────────────────────────────────

/**
 * Fund the caller's base-layer escrow so the post-commit `payout` Magic Action in
 * `endGame` has fees to run. Send on base BEFORE the ER `endGame` fires.
 */
export function buildTopUpEscrow(args: {
  escrowAuthority: Keypair;
  lamports: number;
}): { ix: TransactionInstruction; escrowPda: PublicKey } {
  const escrowPda = escrowPdaFromEscrowAuthority(
    args.escrowAuthority.publicKey
  );
  const ix = createTopUpEscrowInstruction(
    escrowPda,
    args.escrowAuthority.publicKey,
    args.escrowAuthority.publicKey,
    args.lamports
  );
  return { ix, escrowPda };
}

/**
 * End the game on the ER: commits + undelegates state back to base and pays the
 * winner atomically via a Magic Action. `handAccounts` are passed as writable
 * remaining accounts so every hand is undelegated too.
 */
export async function buildEndGame(
  program: Program<LiarDice>,
  args: {
    caller: Keypair;
    game: PublicKey;
    vault: PublicKey;
    winner: PublicKey;
    handAccounts: PublicKey[];
  }
): Promise<Built> {
  const tx = await program.methods
    .endGame()
    .accountsPartial({
      caller: args.caller.publicKey,
      game: args.game,
      vault: args.vault,
      winner: args.winner,
      systemProgram: SYSTEM_PROGRAM,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    })
    .remainingAccounts(
      args.handAccounts.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: true,
      }))
    )
    .transaction();
  return { tx, signers: [args.caller] };
}

/**
 * Reclaim a hand's rent after the game ended and `end_game` undelegated it back to base.
 * Permissionless (`caller` can be anyone); the rent returns to `player`. Send on BASE.
 */
export async function buildCloseHand(
  program: Program<LiarDice>,
  args: {
    caller: Keypair;
    game: PublicKey;
    player: PublicKey;
    playerHand: PublicKey;
  }
): Promise<Built> {
  const tx = await program.methods
    .closeHand()
    .accountsPartial({
      caller: args.caller.publicKey,
      game: args.game,
      player: args.player,
      playerHand: args.playerHand,
    })
    .transaction();
  return { tx, signers: [args.caller] };
}
