import { useEffect, useRef, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { handPda } from "../chain/pdas";
import { buildReveal, buildSettleRound } from "../chain/builders";
import { sendSessionTx } from "../chain/sendSession";
import { useGameState } from "../hooks/useGameState";
import { Dice } from "../ui/Dice";

export function Reveal({
  game, session, sessionToken, fqdn, onDone,
}: {
  game: PublicKey; session: Keypair; sessionToken: PublicKey; fqdn: string;
  onDone: (ended: boolean) => void;
}) {
  const wallet = useAnchorWallet();
  const { signMessage, publicKey } = useWallet();
  const { game: g } = useGameState(fqdn, game);
  const [status, setStatus] = useState("Revealing your dice…");
  const revealed = useRef(false);

  const s = { sessionSigner: session, authority: wallet!.publicKey, sessionToken };
  const withProgram = async () => {
    const conn = await authedErConnection(fqdn, signMessage!, publicKey!);
    return { conn, program: programOn(conn, wallet!) };
  };

  // reveal my hand once
  useEffect(() => {
    if (!wallet || !signMessage || !publicKey || revealed.current) return;
    revealed.current = true;
    (async () => {
      const { conn, program } = await withProgram();
      const tx = await buildReveal(program, s, { game, playerHand: handPda(game, publicKey) });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx);
      setStatus("Revealed. Waiting for opponents…");
    })().catch((e) => setStatus("Error: " + (e as Error).message));
  }, [wallet, signMessage, publicKey]);

  // once everyone has revealed, anyone may settle
  const settle = async () => {
    setStatus("Settling…");
    const { conn, program } = await withProgram();
    const tx = await buildSettleRound(program, s, { game });
    await sendSessionTx(conn, tx.sessionSigner, tx.tx);
    const fresh: any = await program.account.game.fetch(game);
    const ended = Object.keys(fresh.status)[0] === "ended";
    onDone(ended);
  };

  const reveals = g?.lastReveal ?? [];
  return (
    <main className="screen center">
      <h2 className="title">SHOWDOWN</h2>
      <div className="muted">{status}</div>
      {reveals.map((r: any, i: number) => (
        <div className="dice-row" key={i}>
          {(r.dice as number[]).slice(0, r.diceCount).map((d, j) => <Dice key={j} value={d} delay={j * 80} />)}
        </div>
      ))}
      <button className="btn" onClick={settle}>Settle round</button>
    </main>
  );
}
