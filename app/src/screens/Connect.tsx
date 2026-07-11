import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { WalletButton } from "../wallet/WalletButton";
import { useAsyncData } from "../hooks/useAsyncData";

export function Connect() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const balance = useAsyncData(
    async () => {
      if (!publicKey) return null;
      const b = await connection.getBalance(publicKey);
      return b / LAMPORTS_PER_SOL;
    },
    [publicKey, connection],
  );
  const sol = balance.status === "data" ? balance.data : balance.status === "error" ? balance.lastData ?? null : null;

  return (
    <main className="screen center connect-screen">
      <h1 className="title">LIAR&apos;S DICE</h1>
      <WalletButton />
      {publicKey && (
        <div className="card">
          <div className="balance">
            {sol === null && balance.status !== "error" ? "…" : sol === null ? "—" : sol.toFixed(3)} SOL
          </div>
          {balance.status === "error" && (
            <button type="button" className="link balance-retry" onClick={balance.refresh}>
              Couldn't load balance — retry
            </button>
          )}
          {sol !== null && sol < 0.05 && (
            <a className="link" href="https://faucet.solana.com" target="_blank">
              Low balance — get devnet SOL
            </a>
          )}
        </div>
      )}
      <div className="home-powered connect-powered">
        <span className="home-powered-k">Powered by</span>
        <img className="home-powered-logo" src="/magicblock-logo.webp" alt="MagicBlock" />
      </div>
    </main>
  );
}
