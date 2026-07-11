import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { withTxToast } from "../ui/toast";
import { transactionErrorMessage } from "./txError";

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
  return withTxToast(opts.label ?? "Transaction", async () => {
    try {
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: opts.skipPreflight ?? false,
      });
      await connection.confirmTransaction(sig, "confirmed");
      return sig;
    } catch (error) {
      throw new Error(await transactionErrorMessage(error, connection));
    }
  });
}
