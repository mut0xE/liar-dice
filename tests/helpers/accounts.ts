import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { readFileSync, writeFileSync } from "fs";
import { SESSION_TOKEN_SEED } from "./session";

// ── Seeds (must mirror programs/liar-dice/src/state.rs) ─────────────────────
export const GAME_SEED = Buffer.from("game");
export const HAND_SEED = Buffer.from("hand");
export const VAULT_SEED = Buffer.from("vault");
export const IDENTITY_SEED = Buffer.from("identity");

// ── PDA derivation ────────────────────────────────────────────────────────
export function gamePda(
  programId: PublicKey,
  host: PublicKey,
  gameId: anchor.BN
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [GAME_SEED, host.toBuffer(), gameId.toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}

export function handPda(
  programId: PublicKey,
  game: PublicKey,
  player: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [HAND_SEED, game.toBuffer(), player.toBuffer()],
    programId
  )[0];
}

export function vaultPda(programId: PublicKey, game: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, game.toBuffer()],
    programId
  )[0];
}

export function programIdentityPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([IDENTITY_SEED], programId)[0];
}

export function permissionPda(hand: PublicKey): PublicKey {
  return permissionPdaFromAccount(hand);
}

// Session-token PDA the gum-sdk session program derives for (program, signer, authority).
export function sessionTokenPda(
  programId: PublicKey,
  sessionSigner: PublicKey,
  authority: PublicKey,
  sessionProgramId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SESSION_TOKEN_SEED),
      programId.toBytes(),
      sessionSigner.toBytes(),
      authority.toBytes(),
    ],
    sessionProgramId
  )[0];
}

/** Every account the `#[delegate]` macro needs for one delegated PDA. */
export function delegationAccounts(
  delegated: PublicKey,
  ownerProgram: PublicKey
) {
  return {
    bufferAccount: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
      delegated,
      ownerProgram
    ),
    delegationRecord: delegationRecordPdaFromDelegatedAccount(delegated),
    delegationMetadata: delegationMetadataPdaFromDelegatedAccount(delegated),
  };
}

// ── Keypairs ──────────────────────────────────────────────────────────────
/** Load a Keypair from a `solana-keygen`-style JSON secret-key file. */
export function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

/**
 * Load a Keypair from an env var holding a JSON secret-key array (like the
 * session keys), falling back to a `solana-keygen` JSON file path if the env
 * var is unset. Prefer this so player keys live in `.env` rather than on disk.
 */
export function keypairFromEnv(envVar: string, fallbackPath?: string): Keypair {
  const raw = process.env[envVar];
  if (raw) {
    const secret = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  if (fallbackPath) return loadKeypair(fallbackPath);
  throw new Error(
    `Missing ${envVar} in env and no fallback keypair path given`
  );
}

/**
 * Same as `keypairFromEnv`, but if the env var is unset it generates a fresh
 * Keypair and persists it to `.env` (same convention as the session keys in
 * `helpers/session.ts`), instead of throwing. Every later run then reuses the
 * same key. The caller is responsible for funding a freshly generated key
 * (e.g. `fundKeypair`) — this only guarantees a usable, stable keypair.
 */
export function keypairFromEnvOrGenerate(envVar: string): Keypair {
  const raw = process.env[envVar];
  if (raw) {
    const secret = JSON.parse(raw) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  const keypair = Keypair.generate();
  writeFileSync(".env", `\n${envVar}=[${keypair.secretKey.toString()}]\n`, {
    flag: "a",
  });
  console.log(`[accounts] generated + persisted ${envVar} (added to .env)`);
  return keypair;
}
