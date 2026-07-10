import { useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { sessionErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { buildRequestRoll } from "../chain/builders";
import { sendSessionTx } from "../chain/sendSession";
import { useMyHand } from "../hooks/useMyHand";
import { Dice } from "../ui/Dice";
import { useWallet } from "@solana/wallet-adapter-react";

export function Roll({
  game, hand, session, sessionToken, fqdn, onRolled,
}: {
  game: PublicKey; hand: PublicKey; session: Keypair; sessionToken: PublicKey; fqdn: string; onRolled: (dice: number[]) => void;
}) {
  const wallet = useAnchorWallet();
  const { signMessage, publicKey } = useWallet();
  const { dice, rolled, refresh } = useMyHand(fqdn, hand);
  const [busy, setBusy] = useState(false);

  const roll = async () => {
    if (!wallet || !signMessage || !publicKey) return;
    setBusy(true);
    try {
      // requestRoll is session-signed → submit via the session key, no wallet popup.
      // (Reading the resulting private dice below still uses wallet auth, gated by
      // the hand permission — but that token is now cached, so at most one prompt.)
      const conn = await sessionErConnection(fqdn, session);
      const program = programOn(conn, wallet);
      const { tx, sessionSigner } = await buildRequestRoll(
        program,
        { sessionSigner: session, authority: wallet.publicKey, sessionToken },
        { game, playerHand: hand, clientSeed: Math.floor(Math.random() * 256) }
      );
      await sendSessionTx(conn, sessionSigner, tx, "Roll dice");
      navigator.vibrate?.(40);
      // poll for the VRF callback, stopping as soon as the dice land
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 700));
        if (await refresh()) break;
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
          <button className="btn" onClick={() => onRolled(dice!)}>To the table →</button>
        </>
      ) : (
        <button className="btn" onClick={roll} disabled={busy}>
          {busy ? "Rolling (VRF)…" : "Roll dice"}
        </button>
      )}
    </main>
  );
}
