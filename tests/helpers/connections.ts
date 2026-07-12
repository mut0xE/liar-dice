import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ConnectionMagicRouter,
  getAuthToken,
  verifyTeeRpcIntegrity,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import * as nacl from "tweetnacl";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { LiarDice } from "../../target/types/liar_dice";
import { logTx } from "./log";

// This project only ever talks to devnet + MagicBlock's devnet ER — no
// localnet/localnet-validator branches.
export const DEVNET_ENDPOINT = "https://api.devnet.solana.com";

// Devnet TEE-backed ER endpoint. Private dice (PER) only hold their guarantee
// inside a TEE, so we pin this instead of trusting the router's closest (which
// is TEE-agnostic). Overridable via EPHEMERAL_PROVIDER_ENDPOINT in .env.
export const DEVNET_TEE_ENDPOINT = "https://devnet-tee.magicblock.app";

/**
 * Devnet base-layer connection. Prefers HELIUS_RPC_URL (dedicated, avoids public
 * devnet 429s), then ANCHOR_PROVIDER_URL, then falls back to public devnet.
 */
export function devnetConnection(): Connection {
  return new Connection(
    process.env.HELIUS_RPC_URL ||
      process.env.ANCHOR_PROVIDER_URL ||
      DEVNET_ENDPOINT,
    { commitment: "confirmed" }
  );
}

export function routerConnection(): ConnectionMagicRouter {
  const endpoint =
    process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app/";
  return new ConnectionMagicRouter(endpoint, {
    wsEndpoint: endpoint
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://"),
  });
}

/**
 * Resolve the TEE validator for PER: the identity is read straight from the TEE
 * endpoint (`getIdentity`) so the `delegate` remaining-accounts target is the node
 * we actually transact against. `getClosestValidator` is TEE-agnostic — it returns
 * the nearest (non-TEE) node — so using its identity would pin the hand to a
 * different validator than the TEE we send to, and the TEE rejects the write with
 * `InvalidWritableAccount`. The endpoint is cryptographically attested before we
 * trust it with private dice (EPHEMERAL_PROVIDER_ENDPOINT / DEVNET_TEE_ENDPOINT).
 */
export async function teeValidator(): Promise<{
  identity: PublicKey;
  fqdn: string;
}> {
  const fqdn = process.env.EPHEMERAL_PROVIDER_ENDPOINT || DEVNET_TEE_ENDPOINT;
  // Attestation: proves the ER RPC is a genuine enclave, so is_private actually
  // hides the dice. Throws (and fails the test) if the endpoint isn't a real TEE.
  await verifyTeeRpcIntegrity(fqdn);
  const res = (await fetch(fqdn, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }),
  }).then((r) => r.json())) as { result: { identity: string } };
  return { identity: new PublicKey(res.result.identity), fqdn };
}

/**
 * Open an authenticated connection to the TEE ER endpoint. The TEE gates every
 * RPC call behind a `?token=` query param, so we fetch a signed auth token for
 * `signer` and append it to both the HTTP and WS URLs. The token identity also
 * decides which private accounts this connection may read — so read a player's
 * private hand through a connection authed as that player.
 */
export async function authedErConnection(
  fqdn: string,
  signer: Keypair
): Promise<Connection> {
  const { token } = await getAuthToken(fqdn, signer.publicKey, (message) =>
    Promise.resolve(nacl.sign.detached(message, signer.secretKey))
  );
  const http = `${fqdn.replace(/\/$/, "")}?token=${token}`;
  const ws = `${http.replace(/^http/, "ws")}`;
  return new Connection(http, { wsEndpoint: ws, commitment: "confirmed" });
}

/** Build an Anchor program bound to a specific ER connection (for reads/sends on the TEE). */
export function erProgramOn(
  base: Program<LiarDice>,
  connection: Connection,
  wallet: anchor.Wallet
): Program<LiarDice> {
  return new Program<LiarDice>(
    base.idl as unknown as LiarDice,
    new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" })
  );
}

/** Top up `to` from `from` only if its balance is below `minSol` (idempotent for reused devnet wallets). */
export async function fundKeypair(
  connection: Connection,
  from: anchor.Wallet,
  to: PublicKey,
  minSol: number
): Promise<void> {
  const balance = await connection.getBalance(to);
  if (balance >= minSol * LAMPORTS_PER_SOL) {
    console.log(
      `[fund] ${to.toBase58().slice(0, 8)} already has ${
        balance / LAMPORTS_PER_SOL
      } SOL, skipping top-up`
    );
    return;
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: Math.round(minSol * LAMPORTS_PER_SOL) - balance,
    })
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [from.payer], {
    commitment: "confirmed",
  });
  logTx(`fund ${to.toBase58().slice(0, 8)}`, sig);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll until `account` is owned by `owner` again (committed/undelegated back to base).
export async function waitUntilOwnedBy(
  connection: Connection,
  account: PublicKey,
  owner: PublicKey,
  tries = 20
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const info = await connection.getAccountInfo(account);
    if (info && info.owner.equals(owner)) return true;
    await sleep(1000);
  }
  return false;
}

// Poll until `account` is closed — treats both "gone" and "lamports drained to 0"
// as closed, since some RPCs serve a stale "still exists" response for a while.
export async function waitUntilClosed(
  connection: Connection,
  account: PublicKey,
  tries = 20
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const info = await connection.getAccountInfo(account);
    if (!info || info.lamports === 0) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * Stamp fee payer + a fresh blockhash from `connection`, then send + confirm.
 * Pass `printLogs = true` to fetch the confirmed tx and echo its `Program log:`
 * lines (this is where on-chain `msg!` output shows up).
 */
export async function sendOn(
  connection: Connection,
  tx: Transaction,
  feePayer: PublicKey,
  signers: Keypair[],
  printLogs = false
): Promise<string> {
  tx.feePayer = feePayer;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const sig = await sendAndConfirmTransaction(connection, tx, signers, {
    skipPreflight: true,
    commitment: "confirmed",
  });
  if (printLogs) await printProgramLogs(connection, sig);
  return sig;
}

/**
 * Send a builder's `Built` result: stamps the given fee payer + blockhash, signs
 * with `built.signers`, and sends. Fee payer defaults to the first signer.
 */
export async function sendBuilt(
  connection: Connection,
  built: { tx: Transaction; signers: Keypair[] },
  opts: { feePayer?: PublicKey; printLogs?: boolean } = {}
): Promise<string> {
  const feePayer = opts.feePayer ?? built.signers[0].publicKey;
  return sendOn(connection, built.tx, feePayer, built.signers, opts.printLogs);
}

/** Fetch a confirmed tx and print only its `Program log:` (msg!) lines. */
export async function printProgramLogs(
  connection: Connection,
  sig: string
): Promise<void> {
  const info = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const logs = (info?.meta?.logMessages ?? []).filter((l) =>
    l.startsWith("Program log:")
  );
  for (const l of logs) console.log(`   ${l.replace("Program log: ", "")}`);
}

/** Poll a `PlayerHand` on the ER until the VRF callback has landed (`rolled === true`). */
export async function waitForRoll(
  program: Program<LiarDice>,
  hand: PublicKey,
  timeoutMs = 30_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const h = await program.account.playerHand.fetch(hand);
    if (h.rolled) return;
    await sleep(500);
  }
  throw new Error(
    `Timed out waiting for VRF callback on hand ${hand.toBase58()}`
  );
}
