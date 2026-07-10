import { BN, Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  PERMISSION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { LiarDice } from "../idl/liar_dice";
import { handPda } from "./pdas";

export type WalletTx = { tx: Transaction; kind: "wallet" };
export type SessionTx = { tx: Transaction; kind: "session"; sessionSigner: Keypair };

// ── base-layer money txs (wallet-signed) ──
export async function buildCreateGame(
  program: Program<LiarDice>,
  a: { host: PublicKey; game: PublicKey; gameId: BN; entryFee: BN; graceSeconds: number }
): Promise<WalletTx> {
  const tx = await program.methods
    .createGame(a.gameId, a.entryFee, new BN(a.graceSeconds))
    .accountsPartial({ host: a.host, game: a.game, systemProgram: SystemProgram.programId })
    .transaction();
  return { tx, kind: "wallet" };
}

export async function buildJoinGame(
  program: Program<LiarDice>,
  a: { player: PublicKey; game: PublicKey; vault: PublicKey; playerHand: PublicKey }
): Promise<WalletTx> {
  const tx = await program.methods
    .joinGame()
    .accountsPartial({
      player: a.player,
      game: a.game,
      vault: a.vault,
      playerHand: a.playerHand,
      systemProgram: SystemProgram.programId,
    })
    .transaction();
  return { tx, kind: "wallet" };
}

export async function buildStartGame(
  program: Program<LiarDice>,
  a: { host: PublicKey; game: PublicKey }
): Promise<WalletTx> {
  const tx = await program.methods
    .startGame()
    .accountsPartial({ host: a.host, game: a.game })
    .transaction();
  return { tx, kind: "wallet" };
}

// Delegate the caller's OWN hand — bundled into the join tx. The game stays on
// base (players are still joining); only the hand moves to the ER.
export async function buildDelegateHandIx(
  program: Program<LiarDice>,
  a: {
    player: PublicKey;
    host: PublicKey;
    game: PublicKey;
    gameId: BN;
    playerHand: PublicKey;
    validatorIdentity: PublicKey;
  }
): Promise<TransactionInstruction> {
  return program.methods
    .delegateHand(a.gameId)
    .accountsPartial({
      player: a.player,
      host: a.host,
      game: a.game,
      playerHand: a.playerHand,
      validator: a.validatorIdentity,
    })
    .instruction();
}

// Delegate the shared game PDA — bundled into the host's start tx.
export async function buildDelegateGameIx(
  program: Program<LiarDice>,
  a: { payer: PublicKey; host: PublicKey; game: PublicKey; gameId: BN; validatorIdentity: PublicKey }
): Promise<TransactionInstruction> {
  return program.methods
    .delegateGame(a.gameId)
    .accountsPartial({
      payer: a.payer,
      host: a.host,
      game: a.game,
      validator: a.validatorIdentity,
    })
    .instruction();
}

// ── ER gameplay txs (session-signed) ──
type S = { sessionSigner: Keypair; authority: PublicKey; sessionToken: PublicKey };

// init_hand_permission runs on the ER, so it MUST be session-signed — wallet-signing
// an ER tx trips wallets' "network mismatch" guard (they can't recognize the TEE
// genesis hash). The session key acts for `authority`; the permission member is the
// wallet (authority), not the session key.
export async function buildInitHandPermission(
  program: Program<LiarDice>,
  s: S,
  a: { playerHand: PublicKey; permission: PublicKey }
): Promise<SessionTx> {
  const tx = await program.methods
    .initHandPermission()
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      playerHand: a.playerHand,
      permission: a.permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .transaction();
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}

export async function buildRequestRoll(
  program: Program<LiarDice>,
  s: S,
  a: { game: PublicKey; playerHand: PublicKey; clientSeed: number }
): Promise<SessionTx> {
  const tx = await program.methods
    .requestRoll(a.clientSeed)
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: a.game,
      playerHand: a.playerHand,
    })
    .transaction();
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}

// Close the shared roll window and (maybe) open bidding. Standalone — NEVER bundle a
// place_bid after this: begin_bidding may instead reopen the roll window when fewer
// than 2 players rolled, leaving phase == Rolling, which would make a bundled bid fail
// with BadGameState and revert the whole tx (a deadlock). Send this alone, let the game
// state poll settle to Bidding (or back to Rolling), then bid separately.
export async function buildBeginBidding(
  program: Program<LiarDice>,
  s: S,
  a: { game: PublicKey; hands: PublicKey[] }
): Promise<SessionTx> {
  const tx = await program.methods
    .beginBidding()
    .accountsPartial({ caller: s.sessionSigner.publicKey, game: a.game })
    .remainingAccounts(a.hands.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
    .transaction();
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}

// The first-turn player opens bidding AND places their opening bid in ONE tx.
// Safe to bundle (unlike a standalone begin_bidding + later bid): both ixs run in
// the same tx, so if begin_bidding takes the slow path or reopens the roll window
// (phase stays Rolling), the place_bid fails with BadGameState and the WHOLE tx
// reverts atomically — no half-open round, no stuck state. The caller just retries.
// Only offer this to the seat begin_bidding will seat as `current_turn` (the starter),
// or the bundled bid would fail NotYourTurn.
export async function buildOpenAndBid(
  program: Program<LiarDice>,
  s: S,
  a: { game: PublicKey; hands: PublicKey[]; playerHand: PublicKey; quantity: number; face: number }
): Promise<SessionTx> {
  const beginIx = await program.methods
    .beginBidding()
    .accountsPartial({ caller: s.sessionSigner.publicKey, game: a.game })
    .remainingAccounts(a.hands.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
    .instruction();
  const bidIx = await program.methods
    .placeBid(a.quantity, a.face)
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: a.game,
      playerHand: a.playerHand,
    })
    .instruction();
  const tx = new Transaction().add(beginIx, bidIx);
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}

export async function buildPlaceBid(
  program: Program<LiarDice>,
  s: S,
  a: { game: PublicKey; playerHand: PublicKey; quantity: number; face: number }
): Promise<SessionTx> {
  const tx = await program.methods
    .placeBid(a.quantity, a.face)
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: a.game,
      playerHand: a.playerHand,
    })
    .transaction();
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}

export async function buildChallenge(
  program: Program<LiarDice>,
  s: S,
  a: { game: PublicKey }
): Promise<SessionTx> {
  const tx = await program.methods
    .challenge()
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: a.game,
    })
    .transaction();
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}

// Permissionless liveness escape hatch for a stalled BIDDING turn: evict the
// `current_turn` player once the deadline passes. `target` is that player's wallet.
export async function buildForceTimeout(
  program: Program<LiarDice>,
  s: S,
  a: { game: PublicKey; target: PublicKey }
): Promise<SessionTx> {
  const tx = await program.methods
    .forceTimeout(a.target)
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: a.game,
    })
    .transaction();
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}

export async function buildReveal(
  program: Program<LiarDice>,
  s: S,
  a: { game: PublicKey; playerHand: PublicKey }
): Promise<SessionTx> {
  const tx = await program.methods
    .reveal()
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: a.game,
      playerHand: a.playerHand,
    })
    .transaction();
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}

export async function buildSettleRound(
  program: Program<LiarDice>,
  s: S,
  a: { game: PublicKey }
): Promise<SessionTx> {
  const tx = await program.methods
    .settleRound()
    .accountsPartial({
      signer: s.sessionSigner.publicKey,
      authority: s.authority,
      sessionToken: s.sessionToken,
      game: a.game,
    })
    .transaction();
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}

// ── end game (wallet-signed, ER; legacy callers only) ──
export async function buildEndGame(
  program: Program<LiarDice>,
  a: { caller: PublicKey; game: PublicKey; vault: PublicKey; winner: PublicKey; handAccounts: PublicKey[] }
): Promise<WalletTx> {
  const tx = await program.methods
    .endGame()
    .accountsPartial({
      caller: a.caller,
      game: a.game,
      vault: a.vault,
      winner: a.winner,
      systemProgram: SystemProgram.programId,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    })
    .remainingAccounts(a.handAccounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })))
    .transaction();
  return { tx, kind: "wallet" };
}

export async function buildEndGameSession(
  program: Program<LiarDice>,
  s: { sessionSigner: Keypair },
  a: { game: PublicKey; vault: PublicKey; winner: PublicKey; handAccounts: PublicKey[] }
): Promise<SessionTx> {
  const tx = await program.methods
    .endGame()
    .accountsPartial({
      caller: s.sessionSigner.publicKey,
      game: a.game,
      vault: a.vault,
      winner: a.winner,
      systemProgram: SystemProgram.programId,
      magicProgram: MAGIC_PROGRAM_ID,
      magicContext: MAGIC_CONTEXT_ID,
    })
    .remainingAccounts(a.handAccounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })))
    .transaction();
  return { tx, kind: "session", sessionSigner: s.sessionSigner };
}
