import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { withTxToast } from "../ui/toast";
import { transactionErrorMessage } from "./txError";

// Pull the Anchor custom error code out of a confirmed tx's `err` payload,
// shaped like { InstructionError: [i, { Custom: 6018 }] }.
function customErrorCode(err: unknown): number | null {
  const ie = (err as any)?.InstructionError;
  const custom = Array.isArray(ie) ? ie[1]?.Custom : undefined;
  return typeof custom === "number" ? custom : null;
}

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
  const run = async () => {
    try {
      tx.feePayer = sessionSigner.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(sessionSigner);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      // confirmTransaction resolves for ANY landed tx — including one that landed
      // with a program error. It does NOT throw on `value.err`, so without this
      // check a reverted tx (e.g. NotSettled) would still flash a success toast.
      const res = await connection.confirmTransaction(sig, "confirmed");
      if (res.value?.err) {
        // Surface the Anchor custom error code (e.g. 6018) so callers can match it.
        const custom = customErrorCode(res.value.err);
        throw new Error(
          custom !== null
            ? `Transaction reverted (custom program error: ${custom})`
            : `Transaction reverted: ${JSON.stringify(res.value.err)}`
        );
      }
      return sig;
    } catch (error) {
      throw new Error(await transactionErrorMessage(error, connection));
    }
  };
  return opts.quiet ? run() : withTxToast(label, run);
}
