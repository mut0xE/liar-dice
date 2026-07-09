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

// delegate ix (part of the "enter rollup" tx assembled in Task 4)
export async function buildDelegateIx(
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
    .delegate(a.gameId)
    .accountsPartial({
      player: a.player,
      host: a.host,
      game: a.game,
      playerHand: a.playerHand,
      validator: a.validatorIdentity,
    })
    .instruction();
}

export async function buildInitHandPermission(
  program: Program<LiarDice>,
  a: { player: PublicKey; playerHand: PublicKey; permission: PublicKey }
): Promise<WalletTx> {
  const tx = await program.methods
    .initHandPermission()
    .accountsPartial({
      player: a.player,
      playerHand: a.playerHand,
      permission: a.permission,
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .transaction();
  return { tx, kind: "wallet" };
}

// ── ER gameplay txs (session-signed) ──
type S = { sessionSigner: Keypair; authority: PublicKey; sessionToken: PublicKey };

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

export async function buildBeginBiddingAndBid(
  program: Program<LiarDice>,
  s: S,
  a: { game: PublicKey; playerHand: PublicKey; quantity: number; face: number; hands: PublicKey[] }
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
  const tx = new Transaction().add(beginIx).add(bidIx);
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

// ── end game (wallet-signed, ER) ──
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
