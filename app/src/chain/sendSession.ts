import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { pushToast } from "../ui/toast";
import { transactionErrorMessage } from "./txError";
import { confirmWithFallback } from "./confirm";

// Sign an ER gameplay tx with the session key and send with skipPreflight.
// `label` names the tx in the on-screen alert (defaults to "Rollup action").
export async function sendSessionTx(
  connection: Connection,
  sessionSigner: Keypair,
  tx: Transaction,
  label = "Rollup action",
  // Automated actions (auto-reveal, auto-settle) fire on every client but only
  // one lands; the rest revert with a benign race (6018/6001/6018). `quiet` runs
  // them without a toast so those expected reverts don't spam an error alert.
  opts: { quiet?: boolean } = {}
): Promise<string> {
  const run = async (toastId?: number) => {
    try {
      tx.feePayer = sessionSigner.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(sessionSigner);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      // confirmTransaction resolves for ANY landed tx — including one that landed
      // with a program error. It does NOT throw on `value.err`, so without this
      // check a reverted tx (e.g. NotSettled) would still flash a success toast.
      // If it doesn't resolve within the timeout, degrade to a background poll
      // instead of hanging the caller indefinitely.
      const result = await confirmWithFallback({
        confirm: () => connection.confirmTransaction(sig, "confirmed"),
        onUnresolved: () => {
          if (toastId) pushToast({ kind: "pending", label, detail: "Still confirming — this can take a moment on devnet…" }, toastId);
        },
        pollAfterTimeout: () => connection.getSignatureStatus(sig).then((r) => (r.value ? { value: { err: r.value.err } } : null)),
        onResolvedInBackground: (r) => {
          if (!toastId) return;
          if (r.status === "confirmed") pushToast({ kind: "success", label, detail: "Confirmed", sig, erFqdn }, toastId);
          else pushToast({ kind: "error", label, detail: r.error }, toastId);
        },
      });
      if (result.status === "reverted") throw new Error(result.error);
      // "unresolved" already left the "still confirming" pending toast in place
      // (via onUnresolved) — only a real confirmation earns the success toast,
      // otherwise the background poll above will resolve it later.
      if (toastId && result.status === "confirmed") {
        pushToast({ kind: "success", label, detail: "Confirmed", sig, erFqdn }, toastId);
      }
      return sig;
    } catch (error) {
      throw new Error(await transactionErrorMessage(error, connection));
    }
  };
  // The connection endpoint carries the auth token as a query param — strip it
  // so the explorer link exposes only the public TEE URL, never the token.
  const erFqdn = connection.rpcEndpoint.split("?")[0];
  if (opts.quiet) return run();
  const toastId = pushToast({ kind: "pending", label, detail: "Sending…" });
  try {
    return await run(toastId);
  } catch (error) {
    pushToast({ kind: "error", label, detail: error instanceof Error ? error.message : String(error) }, toastId);
    throw error;
  }
}
