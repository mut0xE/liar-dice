import { useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { buildRequestRoll } from "../chain/builders";
import { sendSessionTx } from "../chain/sendSession";
import { useMyHand } from "../hooks/useMyHand";
import { Dice } from "../ui/Dice";
import { useWallet } from "@solana/wallet-adapter-react";

export function Roll({
  game, hand, session, sessionToken, fqdn, onRolled,
}: {
  game: PublicKey; hand: PublicKey; session: Keypair; sessionToken: PublicKey; fqdn: string; onRolled: () => void;
}) {
  const wallet = useAnchorWallet();
  const { signMessage, publicKey } = useWallet();
  const { dice, rolled, refresh } = useMyHand(fqdn, hand);
  const [busy, setBusy] = useState(false);

  const roll = async () => {
    if (!wallet || !signMessage || !publicKey) return;
    setBusy(true);
    try {
      const conn = await authedErConnection(fqdn, signMessage, publicKey);
      const program = programOn(conn, wallet);
      const { tx, sessionSigner } = await buildRequestRoll(
        program,
        { sessionSigner: session, authority: wallet.publicKey, sessionToken },
        { game, playerHand: hand, clientSeed: Math.floor(Math.random() * 256) }
      );
      await sendSessionTx(conn, sessionSigner, tx);
      navigator.vibrate?.(40);
      // poll for VRF callback
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 700));
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen center">
      <h2 className="title">ROLL</h2>
      {rolled && dice ? (
        <>
          <div className="dice-row">
            {dice.map((d, i) => <Dice key={i} value={d} delay={i * 90} />)}
          </div>
          <button className="btn" onClick={onRolled}>To the table →</button>
        </>
      ) : (
        <button className="btn" onClick={roll} disabled={busy}>
          {busy ? "Rolling (VRF)…" : "Roll dice"}
        </button>
      )}
    </main>
  );
}
