import {
  Connection,
  PublicKey,
  SendOptions,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import { pushToast } from "../ui/toast";
import { transactionErrorMessage } from "./txError";
import { confirmWithFallback } from "./confirm";

// Mobile Wallet Adapter's signAndSendTransaction path returns the signature
// base64-encoded instead of the base58 every other Solana tool expects
// (confirmTransaction, getSignatureStatus, explorer links). Base58's alphabet
// never contains +, /, or = — base64's does, near-certainly, in a 64-byte
// signature — so that's a reliable tell to re-encode without misreading a
// signature that was already correct.
function normalizeSignature(sig: string): string {
  if (!/[+/=]/.test(sig)) return sig;
  return utils.bytes.bs58.encode(Buffer.from(sig, "base64"));
}

// Only for SINGLE-SIGNER (wallet-only) transactions — sendTransaction() signs AND
// broadcasts in one wallet-app round trip, which is the recommended path on Mobile
// Wallet Adapter. It does NOT accept extra co-signers on every adapter (the mobile
// adapter ignores `options.signers` entirely) — a transaction needing a co-signer
// (e.g. the session keypair in chain/enter.ts) must use signTransaction() instead
// and apply that signature itself; do not route those through this function.
type WalletSend = {
  publicKey: PublicKey;
  sendTransaction: (tx: VersionedTransaction, connection: Connection, options?: SendOptions) => Promise<string>;
};

// Stamp fee payer + blockhash, then hand off to the wallet to sign + broadcast.
export async function sendWalletTx(
  connection: Connection,
  wallet: WalletSend,
  tx: Transaction,
  opts: { skipPreflight?: boolean; label?: string } = {}
): Promise<string> {
  const label = opts.label ?? "Transaction";
  const toastId = pushToast({ kind: "pending", label, detail: "Sending…" });
  try {
    // Versioned, not legacy: Mobile Wallet Adapter serializes whatever we hand it
    // (with strict signature verification) BEFORE it ever reaches the wallet app —
    // a legacy Transaction throws "Missing signature for public key" for the fee
    // payer's own not-yet-filled slot, since nobody has signed it at that point.
    // VersionedTransaction.serialize() never validates signatures.
    const { blockhash } = await connection.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: tx.instructions,
    }).compileToV0Message();
    const vtx = new VersionedTransaction(message);
    const sig = normalizeSignature(
      await wallet.sendTransaction(vtx, connection, { skipPreflight: opts.skipPreflight ?? false })
    );
    const result = await confirmWithFallback({
      confirm: () => connection.confirmTransaction(sig, "confirmed"),
      onUnresolved: () => pushToast({ kind: "pending", label, detail: "Still confirming — this can take a moment on devnet…" }, toastId),
      pollAfterTimeout: () => connection.getSignatureStatus(sig).then((r) => (r.value ? { value: { err: r.value.err } } : null)),
      onResolvedInBackground: (r) => {
        if (r.status === "confirmed") pushToast({ kind: "success", label, detail: "Confirmed", sig }, toastId);
        else pushToast({ kind: "error", label, detail: r.error }, toastId);
      },
    });
    if (result.status === "reverted") throw new Error(result.error);
    // "unresolved" already left the "still confirming" pending toast in place
    // (via onUnresolved) — only a real confirmation earns the success toast,
    // otherwise the background poll above will resolve it later.
    if (result.status === "confirmed") pushToast({ kind: "success", label, detail: "Confirmed", sig }, toastId);
    return sig;
  } catch (error) {
    const msg = await transactionErrorMessage(error, connection);
    pushToast({ kind: "error", label, detail: msg }, toastId);
    throw new Error(msg);
  }
}
