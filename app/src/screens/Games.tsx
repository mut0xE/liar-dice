import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { GameSummary } from "../chain/games";
import { useGames } from "../hooks/useGames";
import { useGameActions } from "../hooks/useGameActions";
import { short, sol, copyAddress } from "../ui/format";
import { avatarPos } from "../ui/avatar";
import { pushToast } from "../ui/toast";

type Tab = "open" | "ongoing" | "results";

export function Games() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const wallet = useAnchorWallet();
  const { waiting, active, ended, loaded, fetchFailed, erWarning, refresh } = useGames();
  const { busy, join, cancel } = useGameActions();

  const [tab, setTab] = useState<Tab>("open");
  const [openResult, setOpenResult] = useState<string | null>(null);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  if (!publicKey) return null;
  const me = publicKey;

  const onJoin = async (g: GameSummary) => {
    try {
      if (!wallet) throw new Error("Wallet is still connecting. Try again in a moment.");
      const addr = await join(g);
      await refresh();
      navigate(`/table/${addr}`);
    } catch (e) {
      const msg = (e as Error).message ?? "Join failed";
      // 6011 AlreadyJoined: the list was stale and this seat is already at the
      // table — just walk in instead of surfacing an error.
      if (/already joined|6011/i.test(msg)) {
        await refresh();
        navigate(`/table/${g.pubkey.toBase58()}`);
        return;
      }
      pushToast({ kind: "error", label: "Join failed", detail: msg });
    }
  };

  // Host-only: two taps to cancel (arm, then confirm), matching the Waiting Room.
  const onCancel = async (g: GameSummary) => {
    const addr = g.pubkey.toBase58();
    if (confirmCancel !== addr) {
      setConfirmCancel(addr);
      return;
    }
    setConfirmCancel(null);
    try {
      await cancel(g);
      pushToast({ kind: "success", label: "Table cancelled", detail: "Every entry fee was refunded" });
      await refresh();
    } catch (e) {
      pushToast({ kind: "error", label: "Cancel failed", detail: (e as Error).message });
    }
  };

  return (
    <main className="screen games">
      <div className="ribbon rise d1">
        <div className="band">Open Waters</div>
      </div>

      <button className="btn btn-green rise d2 new-game-btn" onClick={() => navigate("/games/new")} disabled={!wallet || !!busy}>
        ⚓ New Table
      </button>

      {/* Segmented selector — show one state at a time so the page reads clean. */}
      <div className="games-tabs rise d3" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "open"}
          className={`game-tab${tab === "open" ? " on" : ""}`}
          onClick={() => setTab("open")}
        >
          <span className="tab-dot open" />
          Open Tables
          <span className="count">{waiting.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "ongoing"}
          className={`game-tab${tab === "ongoing" ? " on" : ""}`}
          onClick={() => setTab("ongoing")}
        >
          <span className="tab-dot live" />
          Ongoing
          <span className="count live">{active.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "results"}
          className={`game-tab${tab === "results" ? " on" : ""}`}
          onClick={() => setTab("results")}
        >
          <span className="tab-dot ended" />
          Results
          <span className="count">{ended.length}</span>
        </button>
      </div>

      {erWarning && (
        <div className="lobby-warning rise d4">
          {erWarning}
        </div>
      )}

      {/* ── Open tables: joinable ── */}
      {tab === "open" && (
      <section className="section rise d4">
        <div className="lbl section-lbl">Open Tables <span className="count">{waiting.length}</span></div>
        <div className="game-grid">
          {waiting.map((g) => {
            const mine = g.host.equals(me);
            const joined = g.players.some((p) => p.equals(me)) || mine;
            const addr = g.pubkey.toBase58();
            const open = openTable === addr;
            const arming = confirmCancel === addr;
            return (
              <div
                className={`card game-card${open ? " open" : ""}`}
                key={addr}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => {
                  setOpenTable(open ? null : addr);
                  if (!open) setConfirmCancel(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenTable(open ? null : addr);
                  }
                }}
              >
                <div className="game-card-top">
                  <span className="mono code copyable" onClick={(e) => { e.stopPropagation(); copyAddress(g.pubkey); }}>{short(g.pubkey)}</span>
                  {mine && <span className="host-mark" title="You created this table">⚓ Your table</span>}
                  <span className="status-tag waiting">WAITING</span>
                  <span className="result-chevron" aria-hidden>▾</span>
                </div>
                <div className="game-card-meta">
                  {g.players.length} aboard · <span className="gold-t">{sol(g.entryFeeLamports)} ◎</span> entry
                </div>

                {open && (
                  <div className="result-log" onClick={(e) => e.stopPropagation()}>
                    <div className="lbl result-lbl">Crew aboard</div>
                    <ul className="result-crew">
                      {g.players.map((p, i) => (
                        <li key={p.toBase58()} className="result-seat">
                          <span className="crew-avatar seat-mini" style={avatarPos(i)} />
                          <span className="mono seat-addr copyable" onClick={() => copyAddress(p)}>{short(p)}</span>
                          {p.equals(g.host) && <span className="seat-tag host">HOST</span>}
                          {p.equals(me) && <span className="seat-tag you">YOU</span>}
                        </li>
                      ))}
                    </ul>

                    <div className="table-actions">
                      {joined ? (
                        <button className="btn btn-blue btn-sm full" onClick={() => navigate(`/table/${addr}`)}>
                          Enter table
                        </button>
                      ) : (
                        <button className="btn btn-green btn-sm full" disabled={!wallet || !!busy} onClick={() => onJoin(g)}>
                          {busy === addr ? "Boarding…" : `Join · ${sol(g.entryFeeLamports)} ◎`}
                        </button>
                      )}
                      {mine && (
                        <button
                          className={`btn btn-sm full ${arming ? "btn-red" : "btn-wood"}`}
                          disabled={!!busy}
                          onClick={() => onCancel(g)}
                        >
                          {busy === "cancel"
                            ? "Refunding crew…"
                            : arming
                              ? "Tap again to cancel & refund"
                              : "Cancel table"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!loaded && <div className="muted empty loading">Scanning the waters…</div>}
          {loaded && fetchFailed && <div className="muted empty">Couldn't reach the fleet — check your connection and retry.</div>}
          {loaded && !fetchFailed && waiting.length === 0 && <div className="muted empty">No open tables. Create one.</div>}
        </div>
      </section>
      )}

      {/* ── Ongoing games ── */}
      {tab === "ongoing" && (
      <section className="section rise d4">
        <div className="lbl section-lbl">Ongoing <span className="count live">{active.length}</span></div>
        <div className="game-grid">
          {active.map((g) => {
            const seat = g.players.findIndex((p) => p.equals(me));
            const iAmIn = seat >= 0 && g.activeSeats[seat];
            const yourTurn = iAmIn && g.currentTurn === seat;
            const addr = g.pubkey.toBase58();
            return (
              <div className="card game-card" key={addr}>
                <div className="game-card-top">
                  <span className="mono code copyable" onClick={() => copyAddress(g.pubkey)}>{short(g.pubkey)}</span>
                  <span className="status-tag rolling">{g.phase.toUpperCase()}</span>
                </div>
                <div className="stat-grid">
                  <div><span className="stat-num">{g.activeSeats.filter(Boolean).length}</span><span className="stat-lbl">alive</span></div>
                  <div><span className="stat-num">{g.round}</span><span className="stat-lbl">round</span></div>
                  <div><span className="stat-num gold-t">{sol(g.potLamports)}</span><span className="stat-lbl">pot ◎</span></div>
                </div>
                <div className="muted bid-line">
                  {g.currentBid ? `Bid: ${g.currentBid.quantity} × ${g.currentBid.face}` : "No bid yet"}
                </div>
                {iAmIn && (
                  <button className="btn btn-red btn-sm full" disabled={!!busy} onClick={() => navigate(`/play/${addr}`)}>
                    {yourTurn ? "Your turn — Resume" : "Resume"}
                  </button>
                )}
              </div>
            );
          })}
          {!loaded && <div className="muted empty loading">Scanning the waters…</div>}
          {loaded && fetchFailed && <div className="muted empty">Couldn't reach the fleet — check your connection and retry.</div>}
          {loaded && !fetchFailed && active.length === 0 && <div className="muted empty">No games in progress.</div>}
        </div>
      </section>
      )}

      {/* ── Results ── */}
      {tab === "results" && (
      <section className="section rise d4">
        <div className="lbl section-lbl">Results <span className="count">{ended.length}</span></div>
        <div className="game-grid">
          {ended.map((g) => {
            const addr = g.pubkey.toBase58();
            const iWon = g.winner && g.winner.equals(me);
            const open = openResult === addr;
            const winnerSeat = g.winner ? g.players.findIndex((p) => p.equals(g.winner!)) : -1;
            const isCancelled = g.status === "Cancelled";
            return (
              <div
                className={`card game-card ${isCancelled ? "cancelled" : "ended"} result-card${open ? " open" : ""}`}
                key={addr}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => setOpenResult(open ? null : addr)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenResult(open ? null : addr);
                  }
                }}
              >
                <div className="game-card-top">
                  <span className="mono code copyable" onClick={(e) => { e.stopPropagation(); copyAddress(g.pubkey); }}>{short(g.pubkey)}</span>
                  <span className={`status-tag ${isCancelled ? "cancelled" : "ended"}`}>{isCancelled ? "CANCELLED" : "ENDED"}</span>
                  <span className="result-chevron" aria-hidden>▾</span>
                </div>
                <div className="game-card-meta">
                  {isCancelled ? "Cancelled — entry fees refunded" : g.winner ? <>Winner <span className="mono copyable" onClick={(e) => { e.stopPropagation(); copyAddress(g.winner!); }}>{short(g.winner)}</span>{iWon ? " 👑" : ""}</> : "No winner"}
                  {" · "}<span className="gold-t">{sol(g.potLamports)} ◎</span>
                </div>

                {open && (
                  <div className="result-log" onClick={(e) => e.stopPropagation()}>
                    {g.winner && winnerSeat >= 0 && (
                      <div className="result-winner">
                        <span className="crew-avatar winner-avatar" style={avatarPos(winnerSeat)}>
                          <span className="winner-crown" aria-hidden>👑</span>
                        </span>
                        <div>
                          <div className="winner-lbl">{iWon ? "You took the pot" : "Winner"}</div>
                          <div className="mono winner-addr copyable" onClick={(e) => { e.stopPropagation(); copyAddress(g.winner!); }}>{short(g.winner)}</div>
                        </div>
                        <span className="winner-pot gold-t">{sol(g.potLamports)} ◎</span>
                      </div>
                    )}

                    <div className="stat-grid">
                      <div><span className="stat-num">{g.players.length}</span><span className="stat-lbl">crew</span></div>
                      <div><span className="stat-num">{g.round}</span><span className="stat-lbl">rounds</span></div>
                      <div><span className="stat-num gold-t">{sol(g.entryFeeLamports)}</span><span className="stat-lbl">entry ◎</span></div>
                    </div>

                    <div className="lbl result-lbl">Crew</div>
                    <ul className="result-crew">
                      {g.players.map((p, i) => {
                        const isWinner = g.winner ? p.equals(g.winner) : false;
                        return (
                          <li key={p.toBase58()} className={`result-seat${isWinner ? " winner" : ""}`}>
                            <span className="crew-avatar seat-mini" style={avatarPos(i)} />
                            <span className="mono seat-addr copyable" onClick={() => copyAddress(p)}>{short(p)}</span>
                            {p.equals(g.host) && <span className="seat-tag host">HOST</span>}
                            {p.equals(me) && <span className="seat-tag you">YOU</span>}
                            <span className={`seat-fate${isWinner ? " won" : ""}`}>
                              {isWinner ? "Won the pot" : "Sunk"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="result-foot">
                      <span className="mono result-id">Game #{g.gameId.toString()}</span>
                      <a
                        className="result-link"
                        href={`https://explorer.solana.com/address/${addr}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on Explorer ↗
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!loaded && <div className="muted empty loading">Scanning the waters…</div>}
          {loaded && fetchFailed && <div className="muted empty">Couldn't reach the fleet — check your connection and retry.</div>}
          {loaded && !fetchFailed && ended.length === 0 && <div className="muted empty">No finished games yet.</div>}
        </div>
      </section>
      )}

      <div className="home-powered games-powered">
        <span className="home-powered-k">Powered by</span>
        <img className="home-powered-logo" src="/magicblock-logo.webp" alt="MagicBlock" />
      </div>
    </main>
  );
}
