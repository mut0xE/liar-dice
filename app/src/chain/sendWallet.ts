import { Connection, PublicKey, Transaction } from "@solana/web3.js";

type Signer = {
  publicKey: PublicKey;
  signTransaction: (t: Transaction) => Promise<Transaction>;
};

// Stamp fee payer + blockhash, sign with the wallet, send + confirm.
// `skipPreflight` MUST be true for ER (TEE) transactions.
export async function sendWalletTx(
  connection: Connection,
  wallet: Signer,
  tx: Transaction,
  opts: { skipPreflight?: boolean } = {}
): Promise<string> {
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: opts.skipPreflight ?? false,
  });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
