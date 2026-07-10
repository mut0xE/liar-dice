import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { WalletButton } from "../wallet/WalletButton";

export function Connect() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [sol, setSol] = useState<number | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setSol(null);
      return;
    }
    connection
      .getBalance(publicKey)
      .then((b) => setSol(b / LAMPORTS_PER_SOL))
      .catch(() => setSol(null));
  }, [publicKey, connection]);

  return (
    <main className="screen center">
      <h1 className="title">LIAR&apos;S DICE</h1>
      <WalletButton />
      {publicKey && (
        <div className="card">
          <div className="balance">
            {sol === null ? "…" : sol.toFixed(3)} SOL
          </div>
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
