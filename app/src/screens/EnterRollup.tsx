import { useEffect, useRef, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { handPda } from "../chain/pdas";
import { setUpHand, resolveGameplayEndpoint } from "../chain/enter";
import { GameSummary } from "../chain/games";

/**
 * Resume/enter into a live game. By the time we get here the caller's hand was
 * already delegated + made private at JOIN, and the game PDA at START — so this
 * screen is an idempotent resolver: it re-verifies hand setup (no popup if already
 * done) and resolves the ER endpoint for gameplay. No re-delegation prompts.
 */
export function EnterRollup({
  game,
  onReady,
}: {
  game: GameSummary;
  onReady: (a: { session: Keypair; sessionToken: PublicKey; fqdn: string; validatorIdentity: PublicKey }) => void;
}) {
  const { connection } = useConnection();
  const { signMessage, publicKey } = useWallet();
  const wallet = useAnchorWallet();
  const [status, setStatus] = useState("Preparing…");
  const [details, setDetails] = useState<string[]>([]);
  const ran = useRef(false);

  useEffect(() => {
    if (wallet && (!signMessage || !publicKey)) {
      setStatus("Error: this wallet must support message signing for MagicBlock PER.");
      return;
    }
    if (!wallet || !signMessage || !publicKey || ran.current) return;
    ran.current = true;
    (async () => {
      const hand = handPda(game.pubkey, wallet.publicKey);
      // Idempotent — pops the wallet only if hand delegation/session are missing.
      const { session, sessionToken, identity } = await setUpHand({
        connection,
        wallet,
        game,
        onStatus: setStatus,
        onDetail: (line) => setDetails((prev) => [...prev, line]),
      });

      setStatus("Waiting for MagicBlock router…");
      const { fqdn } = await resolveGameplayEndpoint(game.pubkey, hand);
      setDetails((prev) => [...prev, `er ${fqdn.replace(/^https?:\/\//, "")}`]);

      setStatus("Ready.");
      onReady({ session, sessionToken, fqdn, validatorIdentity: identity });
    })().catch((e) => setStatus("Error: " + (e as Error).message));
  }, [wallet, signMessage, publicKey, connection, game, onReady]);

  return (
    <main className="screen center">
      <h2 className="title">ENTER THE ROLLUP</h2>
      <div className="muted">{status}</div>
      {details.length > 0 && (
        <div className="rollup-status">
          {details.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </main>
  );
}
