// Stamp fee payer + blockhash, sign with the wallet, send + confirm.
// `skipPreflight` MUST be true for ER (TEE) transactions.
export async function sendWalletTx(connection, wallet, tx, opts = {}) {
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: opts.skipPreflight ?? false,
    });
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
}
