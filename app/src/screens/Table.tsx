import { useEffect, useMemo, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { sessionErConnection } from "../chain/connection";
import { programOn } from "../chain/program";
import { handPda } from "../chain/pdas";
import { buildBeginBidding, buildOpenAndBid, buildPlaceBid, buildChallenge } from "../chain/builders";
import { sendSessionTx } from "../chain/sendSession";
import { useGameState } from "../hooks/useGameState";
import { validateBid } from "../chain/bidRules";

/** Seat begin_bidding will seat as current_turn on the fast (all-rolled) path:
 *  the last loser if they're still active, else the next active seat. Mirrors
 *  open_bidding() on-chain, computed from the PUBLIC game fields (is_active,
 *  last_loser) — we can't read private hands to know participation, but on the
 *  fast path participation == is_active, so this matches. */
function computeStarter(g: any): number {
  const isActive: boolean[] = g.isActive;
  const n = g.players.length;
  const lastLoser = Number(g.lastLoser);
  if (isActive[lastLoser]) return lastLoser;
  let i = (lastLoser + 1) % n;
  while (!isActive[i]) i = (i + 1) % n;
  return i;
}

export function Table({
  game, session, sessionToken, fqdn, myDice, onReveal,
}: {
  game: PublicKey; session: Keypair; sessionToken: PublicKey; fqdn: string; myDice: number[]; onReveal: () => void;
}) {
  const wallet = useAnchorWallet();
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
  const starter = g ? computeStarter(g) : -1;
  const iAmStarter = mySeat >= 0 && mySeat === starter;

  // The roll window / bid clock; drives the timeout fallback so a no-show can't
  // freeze the table. `action_deadline == 0` means nothing is owed.
  const deadlinePassed = useMemo(() => {
    if (!g) return false;
    const dl = Number(g.actionDeadline);
    return dl !== 0 && Date.now() / 1000 > dl;
  }, [g]);

  useEffect(() => {
    if (phase === "revealing") onReveal();
  }, [phase]);

  // Session-key-authed connection: bids/challenges are session-signed, so submitting
  // them needs no wallet popup.
  const withProgram = async () => {
    const conn = await sessionErConnection(fqdn, session);
    return { conn, program: programOn(conn, wallet!) };
  };
  const s = { sessionSigner: session, authority: wallet!.publicKey, sessionToken };

  // Human-friendly reason for a begin_bidding/settle timing revert. The frontend
  // can't read private hands to know if everyone rolled, so DeadlineNotReached here
  // just means "not everyone has rolled yet" — wait and retry, it isn't an error.
  const explain = (e: unknown): string => {
    const m = (e as Error)?.message ?? String(e);
    if (/DeadlineNotReached|6021/.test(m))
      return "Waiting for the other players to roll… (retry once everyone's in)";
    return m;
  };

  // Starter opens bidding AND places the opening bid atomically (one tx). If not
  // everyone has rolled yet the whole tx reverts cleanly — just retry.
  const openAndBid = async () => {
    const v = validateBid(null, { quantity: qty, face });
    if (!v.ok) { setErr(v.reason); return; }
    setErr(null); setTxError(null); setBusy(true);
    try {
      const { conn, program } = await withProgram();
      const hands = (g!.players as PublicKey[]).map((p) => handPda(game, p));
      const hand = handPda(game, wallet!.publicKey);
      const tx = await buildOpenAndBid(program, s, { game, hands, playerHand: hand, quantity: qty, face });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Open bidding + bid");
      navigator.vibrate?.(30);
    } catch (e) {
      setTxError(explain(e));
    } finally { setBusy(false); }
  };

  // Fallback: after the roll deadline anyone may force the round open, skipping
  // no-shows (begin_bidding's slow path). Used when the starter is AWOL.
  const forceOpen = async () => {
    setErr(null); setTxError(null); setBusy(true);
    try {
      const { conn, program } = await withProgram();
      const hands = (g!.players as PublicKey[]).map((p) => handPda(game, p));
      const tx = await buildBeginBidding(program, s, { game, hands });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Open bidding");
    } catch (e) {
      setTxError(explain(e));
    } finally { setBusy(false); }
  };

  const bid = async () => {
    const v = validateBid(prevBid, { quantity: qty, face });
    if (!v.ok) { setErr(v.reason); return; }
    setErr(null); setTxError(null); setBusy(true);
    try {
      const { conn, program } = await withProgram();
      const hand = handPda(game, wallet!.publicKey);
      const tx = await buildPlaceBid(program, s, { game, playerHand: hand, quantity: qty, face });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Place bid");
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
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Challenge");
      navigator.vibrate?.(60);
    } catch (e) {
      setTxError((e as Error).message ?? String(e));
    } finally { setBusy(false); }
  };

  const bidInputs = (
    <div className="row">
      <label>Qty <input type="number" min={1} value={qty} onChange={(e) => setQty(+e.target.value)} /></label>
      <label>Face <input type="number" min={1} max={6} value={face} onChange={(e) => setFace(+e.target.value)} /></label>
    </div>
  );

  const totalDice = g ? (g.diceCounts as number[]).reduce((a, b) => a + Number(b), 0) : 0;

  return (
    <main className="screen">
      <h2 className="title">TABLE</h2>
      <div className="muted">Round {g?.round ?? "…"} · {phase}</div>
      <div className="card">
        Current bid: {prevBid ? `${prevBid.quantity} × ${prevBid.face}s` : "— none —"}
      </div>

      {/* Dice on the table: each seat's remaining count + the running total, so
          bids can be judged against how many dice are actually in play. */}
      {g && (
        <div className="dice-counts">
          {(g.players as PublicKey[]).map((p, i) => (
            <div key={i} className={`seat ${g.isActive[i] ? "" : "out"} ${g.currentTurn === i ? "turn" : ""}`}>
              <span className="mono">#{i}</span>
              <span>{p.equals(wallet!.publicKey) ? "you" : `${p.toBase58().slice(0, 4)}…`}</span>
              <span className="mono">{g.isActive[i] ? `${Number(g.diceCounts[i])}🎲` : "out"}</span>
            </div>
          ))}
          <div className="seat total"><span>Total dice</span><span className="mono">{totalDice}</span></div>
        </div>
      )}

      <div className="dice-row" style={{ margin: "18px 0" }}>
        {myDice.map((d, i) => <span className="mono" key={i}>{d}</span>)}
      </div>

      {phase === "rolling" ? (
        iAmStarter ? (
          <>
            <div className="muted">You lead this round — open bidding with your opening bid.</div>
            {bidInputs}
            {err && <div className="muted">{err}</div>}
            {txError && <div className="tx-error">{txError}</div>}
            <button className="btn" onClick={openAndBid} disabled={busy}>
              {busy ? "Opening…" : "Open bidding + bid"}
            </button>
          </>
        ) : (
          <>
            <div className="muted">Waiting for seat #{starter} to open bidding…</div>
            {txError && <div className="tx-error">{txError}</div>}
            {deadlinePassed && (
              <button className="btn" onClick={forceOpen} disabled={busy}>
                {busy ? "Opening…" : "Force open (skip no-shows)"}
              </button>
            )}
          </>
        )
      ) : myTurn ? (
        <>
          {bidInputs}
          {err && <div className="muted">{err}</div>}
          {txError && <div className="tx-error">{txError}</div>}
          <button className="btn" onClick={bid} disabled={busy}>Raise</button>
          {prevBid && <button className="btn" onClick={challenge} disabled={busy}>Liar! (Challenge)</button>}
        </>
      ) : (
        <div className="muted">Waiting for seat #{g?.currentTurn}…</div>
      )}
    </main>
  );
}
