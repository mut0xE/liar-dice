import { useEffect, useMemo, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { authedErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { handPda } from "../chain/pdas";
import { buildBeginBiddingAndBid, buildPlaceBid, buildChallenge } from "../chain/builders";
import { sendSessionTx } from "../chain/sendSession";
import { useGameState } from "../hooks/useGameState";
import { validateBid } from "../chain/bidRules";

export function Table({
  game, session, sessionToken, fqdn, myDice, onReveal,
}: {
  game: PublicKey; session: Keypair; sessionToken: PublicKey; fqdn: string; myDice: number[]; onReveal: () => void;
}) {
  const wallet = useAnchorWallet();
  const { signMessage, publicKey } = useWallet();
  const { game: g } = useGameState(fqdn, game);
  const [qty, setQty] = useState(1);
  const [face, setFace] = useState(2);
  const [err, setErr] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prevBid = useMemo(() => {
    const b = g?.currentBid;
    return b ? { quantity: Number(b.quantity), face: Number(b.face) } : null;
  }, [g]);

  const mySeat = useMemo(
    () => g?.players.findIndex((p: PublicKey) => p.equals(wallet!.publicKey)) ?? -1,
    [g, wallet]
  );
  const myTurn = g && g.currentTurn === mySeat;
  const phase = g ? Object.keys(g.phase)[0] : "";

  useEffect(() => {
    if (phase === "revealing") onReveal();
  }, [phase]);

  const withProgram = async () => {
    const conn = await authedErConnection(fqdn, signMessage!, publicKey!);
    return { conn, program: programOn(conn, wallet!) };
  };
  const s = { sessionSigner: session, authority: wallet!.publicKey, sessionToken };

  const bid = async () => {
    const v = validateBid(prevBid, { quantity: qty, face });
    if (!v.ok) { setErr(v.reason); return; }
    setErr(null); setTxError(null); setBusy(true);
    try {
      const { conn, program } = await withProgram();
      const hand = handPda(game, wallet!.publicKey);
      const hands = (g!.players as PublicKey[]).map((p) => handPda(game, p));
      // first bid of the round also opens bidding
      const tx = prevBid === null
        ? await buildBeginBiddingAndBid(program, s, { game, playerHand: hand, quantity: qty, face, hands })
        : await buildPlaceBid(program, s, { game, playerHand: hand, quantity: qty, face });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx);
      navigator.vibrate?.(30);
    } catch (e) {
      setTxError((e as Error).message ?? String(e));
    } finally { setBusy(false); }
  };

  const challenge = async () => {
    setTxError(null); setBusy(true);
    try {
      const { conn, program } = await withProgram();
      const tx = await buildChallenge(program, s, { game });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx);
      navigator.vibrate?.(60);
    } catch (e) {
      setTxError((e as Error).message ?? String(e));
    } finally { setBusy(false); }
  };

  return (
    <main className="screen">
      <h2 className="title">TABLE</h2>
      <div className="muted">Round {g?.round ?? "…"} · {phase}</div>
      <div className="card">
        Current bid: {prevBid ? `${prevBid.quantity} × ${prevBid.face}s` : "— none —"}
      </div>
      <div className="dice-row" style={{ margin: "18px 0" }}>
        {myDice.map((d, i) => <span className="mono" key={i}>{d}</span>)}
      </div>
      {myTurn ? (
        <>
          <div className="row">
            <label>Qty <input type="number" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} /></label>
            <label>Face <input type="number" min={1} max={6} value={face} onChange={(e) => setFace(+e.target.value)} /></label>
          </div>
          {err && <div className="muted">{err}</div>}
          {txError && <div className="tx-error">{txError}</div>}
          <button className="btn" onClick={bid} disabled={busy}>Raise</button>
          {prevBid && <button className="btn" onClick={challenge} disabled={busy}>Liar! (Challenge)</button>}
        </>
      ) : (
        <div className="muted">Waiting for seat {g?.currentTurn}…</div>
      )}
    </main>
  );
}
