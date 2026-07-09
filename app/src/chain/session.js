import { BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
const KEY_PREFIX = "liar-dice.session.";
export function getOrCreateSessionKey(gameKey) {
    const stored = localStorage.getItem(KEY_PREFIX + gameKey);
    if (stored)
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(stored)));
    const kp = Keypair.generate();
    localStorage.setItem(KEY_PREFIX + gameKey, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
}
// SessionTokenManager requires (wallet, connection) — not a provider.
export function sessionManager(wallet, connection) {
    return new SessionTokenManager(wallet, connection);
}
export async function buildCreateSessionIx(manager, a) {
    const ttl = a.ttlSeconds ?? 3600;
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
