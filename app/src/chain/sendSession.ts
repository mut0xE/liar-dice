import { Connection, Keypair, Transaction } from "@solana/web3.js";

// Sign an ER gameplay tx with the session key and send with skipPreflight.
export async function sendSessionTx(
  connection: Connection,
  sessionSigner: Keypair,
  tx: Transaction
): Promise<string> {
  tx.feePayer = sessionSigner.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(sessionSigner);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
