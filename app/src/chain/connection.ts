import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  ConnectionMagicRouter,
  getAuthToken,
  verifyTeeRpcIntegrity,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { DEVNET_ENDPOINT, DEVNET_TEE_ENDPOINT, ROUTER_ENDPOINT } from "./constants";

export function normalizeErEndpoint(fqdn: string): string {
  return fqdn.replace(/\/+$/, "");
}

export function baseConnection(): Connection {
  return new Connection(DEVNET_ENDPOINT, { commitment: "confirmed" });
}

export function routerConnection(): ConnectionMagicRouter {
  return new ConnectionMagicRouter(ROUTER_ENDPOINT, {
    wsEndpoint: ROUTER_ENDPOINT.replace(/^https:\/\//, "wss://"),
  });
}

// Resolve the TEE validator identity + fqdn (attested before trusting private dice).
export async function teeValidator(): Promise<{ identity: PublicKey; fqdn: string }> {
  const fqdn = normalizeErEndpoint(DEVNET_TEE_ENDPOINT);
  await verifyTeeRpcIntegrity(fqdn);
  const res = (await fetch(fqdn, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }),
  }).then((r) => r.json())) as { result: { identity: string } };
  return { identity: new PublicKey(res.result.identity), fqdn };
}

// Read-only identity used only to mint an ER auth token for public reads (e.g. `game`).
// SECURITY: this keypair is public (bundled in the client build) and holds no SOL —
// never use it as a tx signer, fee payer, or PER permission member.
let readerKp: Keypair | null = null;
function readerKeypair(): Keypair {
  if (readerKp) return readerKp;
  const fromEnv = import.meta.env.VITE_ER_READER_SECRET;
  if (!fromEnv) {
    throw new Error(
      "VITE_ER_READER_SECRET is not set. Add a Keypair secretKey (JSON array) to your env to enable ER reads."
    );
  }
  readerKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fromEnv)));
  return readerKp;
}

// Public pubkey of the read-only reader identity (safe to expose; already public).
export function readerIdentity(): PublicKey {
  return readerKeypair().publicKey;
}

// Throws if `pubkey` is the read-only reader identity — call before granting privilege.
export function assertNotReaderIdentity(pubkey: PublicKey): void {
  let reader: PublicKey;
  try {
    reader = readerKeypair().publicKey;
  } catch {
    return; // No reader configured → nothing to guard against.
  }
  if (pubkey.equals(reader)) {
    throw new Error(
      "Refusing to grant privilege to the read-only ER reader identity. " +
        "It is public (bundled in the client) and must never sign txs or be a permission member."
    );
  }
}

// Token-authed ER connection using the env reader identity (no wallet popup). Cached
// per endpoint so we don't mint a fresh token (and 429) on every poll tick.
const readerConns = new Map<string, Promise<Connection>>();
export function readerErConnection(fqdn: string = DEVNET_TEE_ENDPOINT): Promise<Connection> {
  const endpoint = normalizeErEndpoint(fqdn);
  const cached = readerConns.get(endpoint);
  if (cached) return cached;
  const next = (async () => {
    const kp = readerKeypair();
    const signMessage = async (m: Uint8Array) => nacl.sign.detached(m, kp.secretKey);
    return authedErConnection(endpoint, signMessage, kp.publicKey);
  })();
  readerConns.set(endpoint, next);
  return next;
}

// Drop the cached ER connection so the next call re-auths (e.g. token expired).
export function resetReaderErConnection(): void {
  readerConns.clear();
}

// Cache auth tokens per (endpoint, identity) so the wallet signs at most once per session.
const authTokenCache = new Map<string, { token: string; expiresAt: number }>();
const authTokenInflight = new Map<string, Promise<{ token: string; expiresAt: number }>>();

async function cachedAuthToken(
  endpoint: string,
  pubkey: PublicKey,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const key = `${endpoint}|${pubkey.toBase58()}`;
  const hit = authTokenCache.get(key);
  // Refresh a minute early so an in-flight request never rides an expiring token.
  if (hit && hit.expiresAt - 60_000 > Date.now()) return hit.token;
  const pending = authTokenInflight.get(key);
  if (pending) return (await pending).token;

  const next = getAuthToken(endpoint, pubkey, signMessage).then(({ token, expiresAt }) => {
    authTokenCache.set(key, { token, expiresAt });
    authTokenInflight.delete(key);
    return { token, expiresAt };
  }).catch((error) => {
    authTokenInflight.delete(key);
    throw error;
  });
  authTokenInflight.set(key, next);
  return (await next).token;
}

// Drop cached auth tokens (e.g. the TEE rejected one) so the next call re-signs.
export function resetAuthTokens(): void {
  authTokenCache.clear();
  authTokenInflight.clear();
}

// Authed TEE connection; `pubkey`'s signature decides which private accounts it can read.
export async function authedErConnection(
  fqdn: string,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>,
  pubkey: PublicKey
): Promise<Connection> {
  const endpoint = normalizeErEndpoint(fqdn);
  const token = await cachedAuthToken(endpoint, pubkey, signMessage);
  const http = `${endpoint}?token=${token}`;
  const ws = http.replace(/^http/, "ws");
  return new Connection(http, { wsEndpoint: ws, commitment: "confirmed" });
}

// ER connection authed by the player's session key (no wallet popup) — use for
// submitting session-signed gameplay txs. Private dice reads still need the wallet.
export async function sessionErConnection(
  fqdn: string,
  session: Keypair
): Promise<Connection> {
  const signMessage = async (m: Uint8Array) => nacl.sign.detached(m, session.secretKey);
  return authedErConnection(fqdn, signMessage, session.publicKey);
}
