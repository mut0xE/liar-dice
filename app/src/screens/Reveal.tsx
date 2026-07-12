import { useEffect, useMemo, useRef, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { sessionErConnection } from "../chain/connection";
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
  const { publicKey } = useWallet();
  const { game: g } = useGameState(fqdn, game);
  const [status, setStatus] = useState("Revealing your dice…");
  const [settleError, setSettleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revealed = useRef(false);
  const autoSettled = useRef(false);

  // Both fields are on the PUBLIC game account, so unlike the roll phase we CAN
  // tell client-side when settle will succeed: every participant has revealed, or
  // the reveal deadline has passed (settle_round then slashes the no-shows).
  const participatingCount = useMemo(
    () => (g ? (g.participating as boolean[]).filter(Boolean).length : 0),
    [g]
  );
  const allRevealed = g ? (g.lastReveal?.length ?? 0) >= participatingCount && participatingCount > 0 : false;
  const deadlinePassed = useMemo(() => {
    if (!g) return false;
    const dl = Number(g.actionDeadline);
    return dl !== 0 && Date.now() / 1000 > dl;
  }, [g]);
  const canSettle = allRevealed || deadlinePassed;

  const s = { sessionSigner: session, authority: wallet!.publicKey, sessionToken };
  // Reveal/settle are session-signed → submit via the session key, no wallet popup.
  const withProgram = async () => {
    const conn = await sessionErConnection(fqdn, session);
    return { conn, program: programOn(conn, wallet!) };
  };

  useEffect(() => {
    if (!wallet || !publicKey || revealed.current) return;
    revealed.current = true;
    (async () => {
      const { conn, program } = await withProgram();
      const tx = await buildReveal(program, s, { game, playerHand: handPda(game, publicKey) });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Reveal dice");
      setStatus("Revealed. Waiting for opponents…");
    })().catch((e) => setStatus("Error: " + (e as Error).message));
  }, [wallet, publicKey]);

  const settle = async () => {
    setSettleError(null);
    setBusy(true);
    setStatus("Settling…");
    try {
      const { conn, program } = await withProgram();
      const tx = await buildSettleRound(program, s, { game });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Settle round");
      const fresh: any = await program.account.game.fetch(game);
      const ended = Object.keys(fresh.status)[0] === "ended";
      onDone(ended);
    } catch (e) {
      setSettleError((e as Error).message ?? String(e));
      setStatus("Settling failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  // Once everyone has revealed, settle automatically — no need for a human to
  // click, and it clears the round for the next roll without a stuck screen.
  useEffect(() => {
    if (!canSettle || busy || autoSettled.current) return;
    autoSettled.current = true;
    settle();
  }, [canSettle, busy]);

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
      {settleError && <div className="tx-error">{settleError}</div>}
      {!canSettle && (
        <div className="muted">
          Waiting for reveals ({g?.lastReveal?.length ?? 0}/{participatingCount})…
        </div>
      )}
      <button className="btn" onClick={settle} disabled={busy || !canSettle}>
        {busy ? "Settling…" : "Settle round"}
      </button>
    </main>
  );
}
