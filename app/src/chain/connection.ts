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

// A stable read-only identity for the TEE endpoint. The PER validator gates
// *all* RPC (incl. getProgramAccounts) behind an auth token, so even public
// reads of non-permissioned accounts (like `game`) need a token'd connection.
// The game account isn't permission-gated, so any identity can read it — we
// just need one that can mint a token. Read strictly from env so the same
// reader identity is used in dev and production (set VITE_ER_READER_SECRET to a
// Keypair secretKey as a JSON array).
//
// SECURITY INVARIANT — the reader identity is READ-ONLY and PUBLIC.
// `VITE_ER_READER_SECRET` is compiled into the shipped client bundle, so this
// keypair must be treated as known to everyone. It is safe ONLY because it has
// zero authority: it holds no SOL, never signs a transaction, and is never a
// permission member. Its single job is signing the ER auth *challenge* to mint a
// token that reads the non-private `game` account.
//
// DO NOT, EVER:
//   - pass `readerKeypair()` as a transaction fee payer or instruction signer,
//   - add its pubkey to a hand's PER permission members (that would expose dice),
//   - fund it, or reuse it as a wallet/session identity.
// Private reads and gameplay txs must use the player's wallet or session key.
// Call `assertNotReaderIdentity()` on any pubkey before granting it privilege.
//
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

// Guard: throw if `pubkey` is the read-only reader identity. Call this before
// using any pubkey as a tx signer/fee payer or adding it to a PER permission,
// so the reader can never silently be granted privilege.
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

// Token-authed ER connection using the env reader identity (no wallet popup).
// Cached: minting an auth token every poll tick is what triggers RPC 429s, so
// we reuse one connection until it errors (then callers clear it via reset).
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

// Auth tokens are valid ~30 days but `getAuthToken` re-signs a fresh challenge on
// EVERY call — with a wallet signer that means a message-sign popup per action and
// per poll tick. Cache the token per (endpoint, identity) so the wallet is asked
// to sign at most once per ER session. Keyed by pubkey, so wallet and session-key
// identities get separate tokens.
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

// Authed TEE connection. `signMessage` signs the auth challenge as `pubkey`
// (wallet-adapter's signMessage, or a session key's nacl signer). The token
// identity decides which private accounts this connection may read. Tokens are
// cached per identity, so the wallet is prompted at most once per ER session.
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

// ER connection authed by the player's SESSION KEY (nacl) instead of the wallet —
// no popup. Use for SUBMITTING session-signed gameplay txs (roll/bid/challenge/
// reveal/settle): the tx carries its own session signature, so the connection
// identity only needs a valid RPC token, not the wallet. (Reads of the player's
// PRIVATE dice still need the wallet identity, which the permission gates.)
export async function sessionErConnection(
  fqdn: string,
  session: Keypair
): Promise<Connection> {
  const signMessage = async (m: Uint8Array) => nacl.sign.detached(m, session.secretKey);
  return authedErConnection(fqdn, signMessage, session.publicKey);
}
