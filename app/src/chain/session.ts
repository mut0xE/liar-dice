import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor/dist/cjs/provider";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";

const KEY_PREFIX = "liar-dice.session.";

export function getOrCreateSessionKey(gameKey: string): Keypair {
  const stored = localStorage.getItem(KEY_PREFIX + gameKey);
  if (stored) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
  const kp = Keypair.generate();
  localStorage.setItem(KEY_PREFIX + gameKey, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

// SessionTokenManager requires (wallet, connection) — not a provider.
export function sessionManager(wallet: Wallet, connection: Connection): SessionTokenManager {
  return new SessionTokenManager(wallet, connection);
}

// Session tokens carry a `valid_until` and expire; an expired token makes every
// gameplay ix fail with session_keys `InvalidToken` (6001). Give them a generous
// window so a single sit-down doesn't outlive its key. Crate caps this at 7 days.
export const DEFAULT_SESSION_TTL_SECONDS = 6 * 60 * 60; // 6 hours

export async function buildCreateSessionIx(
  manager: SessionTokenManager,
  a: { targetProgram: PublicKey; sessionSigner: PublicKey; feePayer: PublicKey; ttlSeconds?: number; topUpLamports?: number }
) {
  const ttl = a.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const topUp = a.topUpLamports ?? 0.005 * LAMPORTS_PER_SOL;
  return manager.program.methods
    .createSessionV2(true, new BN(Math.floor(Date.now() / 1000) + ttl), new BN(topUp))
    .accounts({
      targetProgram: a.targetProgram,
      sessionSigner: a.sessionSigner,
      feePayer: a.feePayer,
      authority: a.feePayer,
    })
    .instruction();
}

// `valid_until` (unix seconds) of an on-chain SessionTokenV2, or null if the
// account doesn't exist. Layout: 8 disc + 4×32 pubkeys + i64 valid_until.
export async function readSessionValidUntil(
  connection: Connection,
  sessionToken: PublicKey
): Promise<number | null> {
  const info = await connection.getAccountInfo(sessionToken);
  if (!info) return null;
  const VALID_UNTIL_OFFSET = 8 + 32 * 4;
  return Number(info.data.readBigInt64LE(VALID_UNTIL_OFFSET));
}

// Reclaim an expired (or soon-to-expire) token so a fresh one can take its PDA.
// For an already-expired token the crate lets anyone revoke; `authority` need not
// sign. Lamports return to `feePayer`.
export async function buildRevokeSessionIx(
  manager: SessionTokenManager,
  a: { sessionToken: PublicKey; authority: PublicKey; feePayer: PublicKey }
) {
  return manager.program.methods
    .revokeSessionV2()
    .accounts({
      sessionToken: a.sessionToken,
      feePayer: a.feePayer,
      authority: a.authority,
    })
    .instruction();
}
