import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { pushToast } from "../ui/toast";
import { transactionErrorMessage } from "./txError";
import { confirmWithFallback } from "./confirm";

type Signer = {
  publicKey: PublicKey;
  signTransaction: (t: Transaction) => Promise<Transaction>;
};

// Stamp fee payer + blockhash, sign with the wallet, send + confirm. skipPreflight must be true for ER txs.
export async function sendWalletTx(
  connection: Connection,
  wallet: Signer,
  tx: Transaction,
  opts: { skipPreflight?: boolean; label?: string } = {}
): Promise<string> {
  const label = opts.label ?? "Transaction";
  const toastId = pushToast({ kind: "pending", label, detail: "Sending…" });
  try {
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: opts.skipPreflight ?? false,
    });
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
