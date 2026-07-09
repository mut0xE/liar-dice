import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export function Connect() {
  const { connection } = useConnection();
  const { publicKey, connect, connecting } = useWallet();
  const [sol, setSol] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) return;
    connection.getBalance(publicKey).then((b) => setSol(b / LAMPORTS_PER_SOL));
  }, [publicKey, connection]);

  return (
    <main className="screen center">
      <h1 className="title">LIAR&apos;S DICE</h1>
      {!publicKey ? (
        <button className="btn" onClick={() => connect()} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect Wallet"}
        </button>
      ) : (
        <div className="card">
          <div className="mono">{publicKey.toBase58().slice(0, 8)}…</div>
          <div className="balance">{sol === null ? "…" : sol.toFixed(3)} SOL</div>
          {sol !== null && sol < 0.05 && (
            <a className="link" href="https://faucet.solana.com" target="_blank">
              Low balance — get devnet SOL
            </a>
          )}
        </div>
      )}
    </main>
  );
}
