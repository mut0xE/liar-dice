import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { useGames, findGameByAddress } from "../hooks/useGames";
import { useGameActions } from "../hooks/useGameActions";
import { short, sol } from "../ui/format";
import { avatarPos } from "../ui/avatar";
import { pushToast } from "../ui/toast";

export function WaitingRoom() {
  const { addr } = useParams();
  const navigate = useNavigate();
  const wallet = useAnchorWallet();
  const { games, loaded } = useGames(4000);
  const { busy, start, cancel } = useGameActions();
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  // Cancelling refunds real SOL and kills the table — ask for a second tap.
  const [confirmCancel, setConfirmCancel] = useState(false);

  const g = findGameByAddress(games, addr);
  const me = wallet?.publicKey;
  const joined = Boolean(g && me && g.players.some((p) => p.equals(me)));

  // Host started the game (status flipped to Active) → seated players sail on.
  useEffect(() => {
    if (g && g.status === "Active" && joined) navigate(`/play/${addr}`, { replace: true });
  }, [g, joined, addr, navigate]);

  // Host cancelled the table → every seated crew member (not just the host,
  // who navigates away directly in onCancel) sees it and gets bounced out.
  useEffect(() => {
    if (g && g.status === "Cancelled" && joined) {
      pushToast({ kind: "error", label: "Game cancelled", detail: "The captain called it off — entry fee refunded" });
      navigate("/games", { replace: true });
    }
  }, [g, joined, addr, navigate]);

  if (!wallet) return null;

  if (!g) {
    return (
      <main className="screen waiting center-screen">
        <div className="ribbon"><div className="band">Mustering Crew</div></div>
        <div className="muted" style={{ marginTop: 20 }}>
          {loaded ? "Table not found — it may have started or been cancelled." : "Loading table…"}
        </div>
        {loaded && <Link className="btn btn-blue btn-sm" to="/games" style={{ marginTop: 14 }}>Back to Open Waters</Link>}
      </main>
    );
  }

  if (g.status === "Cancelled") {
    return (
      <main className="screen waiting center-screen">
        <div className="ribbon"><div className="band band-danger">Voyage Cancelled</div></div>
        <div className="muted" style={{ marginTop: 20 }}>
          The captain called off this table. Entry fees were refunded.
        </div>
        <Link className="btn btn-blue btn-sm" to="/games" style={{ marginTop: 14 }}>Back to Open Waters</Link>
      </main>
    );
  }

  const isHost = Boolean(me && g.host.equals(me));
  const canStart = g.players.length >= 2;
  const seatCap = Math.max(g.players.length, 2);
  const emptySeats = Math.max(0, seatCap - g.players.length);

  const onStart = async () => {
    try {
      const a = await start(g);
      navigate(`/play/${a}`, { replace: true });
    } catch (e) {
      pushToast({ kind: "error", label: "Start failed", detail: (e as Error).message });
    }
  };

  const onCancel = async () => {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    try {
      await cancel(g);
      pushToast({ kind: "success", label: "Game cancelled", detail: "Every entry fee was refunded" });
      navigate("/games", { replace: true });
    } catch (e) {
      setConfirmCancel(false);
      pushToast({ kind: "error", label: "Cancel failed", detail: (e as Error).message });
    }
  };

  const onCopy = () => {
    navigator.clipboard?.writeText(g.pubkey.toBase58());
    pushToast({ kind: "success", label: "Table address copied" });
  };

  return (
    <main className="screen waiting">
      <div className="ribbon rise d1"><div className="band">Mustering Crew</div></div>
      <div className="waiting-code rise d2">{isHost ? "You are captain" : "Waiting for captain"}</div>

      <section className="muster-card rise d3">
        <div className="muster-prize">
          <div>
            <div className="chest-k">PRIZE POT</div>
            <div className="disp gold-t chest-amt">{sol(g.potLamports)} ◎</div>
          </div>
        </div>

        <div className="crew-row">
          {g.players.map((p, i) => {
            const isMe = Boolean(me && p.equals(me));
            const isCaptain = p.equals(g.host);
            return (
              <button
                type="button"
                key={p.toBase58()}
                className={`crew-chip${isMe ? " me" : ""}${openSeat === i ? " open" : ""}`}
                onClick={() => setOpenSeat(openSeat === i ? null : i)}
                title={p.toBase58()}
              >
                <span className="crew-avatar" style={avatarPos(i)}>
                  {isCaptain && <span className="crew-flag" title="Captain">★</span>}
                </span>
                <span className="crew-name">{isMe ? "you" : short(p)}</span>
                <span className="crew-status">{isCaptain ? "captain" : "crew"}</span>
              </button>
            );
          })}
          {Array.from({ length: emptySeats }).map((_, i) => (
            <div className="crew-chip ghost" key={`e${i}`}>
              <span className="crew-avatar empty seatwait" />
              <span className="crew-name">waiting…</span>
              <span className="crew-status">open seat</span>
            </div>
          ))}
        </div>
        {openSeat !== null && g.players[openSeat] && (
          <button
            type="button"
            className="crew-pub mono"
            onClick={() => {
              navigator.clipboard?.writeText(g.players[openSeat].toBase58());
              pushToast({ kind: "success", label: "Address copied" });
            }}
          >
            {g.players[openSeat].toBase58()}
            <small>{me && g.players[openSeat].equals(me) ? "your wallet — " : ""}tap to copy</small>
          </button>
        )}

        <div className="row wait-hud">
          <div className="hud"><span className="hud-k">ENTRY</span><span className="gold-t">{sol(g.entryFeeLamports)} ◎</span></div>
          <div className="hud"><span className="hud-k">CREW</span><span className="gold-t">{g.players.length}</span></div>
        </div>
      </section>

      <button type="button" className="plank invite-plank rise d5" onClick={onCopy}>
        <span className="nail tl" /><span className="nail tr" /><span className="nail bl" /><span className="nail br" />
        <div className="invite-inner">
          <div className="invite-lbl">TABLE ADDRESS — TAP TO COPY</div>
          <div className="disp gold-t invite-code">{short(g.pubkey)}</div>
          <div className="invite-note">Entry SOL stays in escrow until the game settles</div>
        </div>
      </button>

      <div className="wait-dock rise d6">
        {isHost ? (
          <button className={`btn btn-lg full ${canStart ? "btn-gold pulse" : "btn-dim"}`} disabled={!canStart || !!busy} onClick={onStart}>
            {busy ? "Hoisting anchor…" : canStart ? "⚓ Hoist Anchor — Set Sail" : `Need 2 aboard — ${g.players.length}/2`}
          </button>
        ) : (
          <button className="btn btn-dim full" disabled>
            Waiting for captain to set sail — {g.players.length} aboard
          </button>
        )}
        {isHost && g.status === "Waiting" && (
          <button className="link-btn abandon" onClick={onCancel} disabled={busy === "cancel"}>
            {busy === "cancel"
              ? "Cancelling & refunding…"
              : confirmCancel
                ? "Tap again to confirm — refunds all entry fees"
                : "Cancel game — refund crew"}
          </button>
        )}
        <button className="link-btn abandon" onClick={() => navigate("/games")}>Abandon ship</button>
      </div>
    </main>
  );
}
