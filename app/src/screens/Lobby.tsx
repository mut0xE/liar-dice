import { useCallback, useEffect, useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { programOn } from "../chain/program";
import { gamePda, vaultPda, handPda } from "../chain/pdas";
import { listAllGames, GameSummary } from "../chain/games";
import { buildCreateGame, buildJoinGame, buildStartGame, buildDelegateGameIx } from "../chain/builders";
import { sendWalletTx } from "../chain/sendWallet";
import { setUpHand } from "../chain/enter";
import { teeValidator } from "../chain/connection";
import { Transaction } from "@solana/web3.js";

const short = (k: PublicKey) => k.toBase58().slice(0, 4) + "…" + k.toBase58().slice(-4);
const sol = (l: BN) => (l.toNumber() / LAMPORTS_PER_SOL).toFixed(3);

export function Lobby({ onEnter }: { onEnter: (g: GameSummary) => void }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [entryFee, setEntryFee] = useState("0.01");
  const [graceSeconds, setGraceSeconds] = useState("60");
  const [formError, setFormError] = useState<string | null>(null);
  const [detail, setDetail] = useState<GameSummary | null>(null);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    const program = programOn(connection, wallet);
    setGames(await listAllGames(program, wallet));
  }, [connection, wallet]);

  useEffect(() => {
    refresh();
    // Public devnet rate-limits getProgramAccounts; poll gently to avoid 429s.
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, [refresh]);

  const { waiting, active, ended } = useMemo(() => ({
    waiting: games.filter((g) => g.status === "Waiting"),
    active: games.filter((g) => g.status === "Active"),
    ended: games.filter((g) => g.status === "Ended"),
  }), [games]);

  if (!wallet) return null;
  const program = programOn(connection, wallet);
  const me = wallet.publicKey;

  const create = async () => {
    const feeSol = Number(entryFee);
    const grace = Math.floor(Number(graceSeconds));
    if (!Number.isFinite(feeSol) || feeSol < 0) {
      setFormError("Entry fee must be 0 or more SOL.");
      return;
    }
    if (!Number.isFinite(grace) || grace < 1) {
      setFormError("Turn timer must be at least 1 second.");
      return;
    }
    setFormError(null);
    setBusy("create");
    try {
      const gameId = new BN(Date.now());
      const game = gamePda(me, gameId);
      const entryFee = new BN(Math.round(feeSol * LAMPORTS_PER_SOL));

      // ONE wallet tx does the whole create flow: create_game + join_game +
      // (topup + delegate_hand + create_session, added by setUpHand). Bundling
      // create_game and join_game as prepend ixs means a rejected signature
      // creates NOTHING — no half-made ghost table with the host un-joined and
      // un-delegated (which showed a dead, disabled Start and no way forward).
      const createIx = (
        await buildCreateGame(program, { host: me, game, gameId, entryFee, graceSeconds: grace })
      ).tx.instructions[0];
      const joinIx = (
        await buildJoinGame(program, {
          player: me,
          game,
          vault: vaultPda(game),
          playerHand: handPda(game, me),
        })
      ).tx.instructions[0];

      // The game isn't on chain yet, but setUpHand only needs pubkey/host/gameId
      // to build delegate_hand — synthesize a summary for those fields.
      const pending: GameSummary = {
        pubkey: game,
        host: me,
        gameId,
        entryFeeLamports: entryFee,
        players: [me],
        status: "Waiting",
        potLamports: entryFee,
        round: 0,
        phase: "Rolling",
        currentTurn: 0,
        currentBid: null,
        activeSeats: [true],
        winner: null,
      };
      await setUpHand({ connection, wallet, game: pending, prependIxs: [createIx, joinIx] });
      setShowForm(false);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  // Join a table AND set the caller up on the ER in one flow: a single wallet tx does
  // join_game + delegate_hand + create_session, then dice are made private on the ER.
  // Delegation happens ONCE, here — never re-prompted on resume.
  const joinAndDelegate = async (g: GameSummary) => {
    setBusy(g.pubkey.toBase58());
    try {
      const joinIx = (
        await buildJoinGame(program, {
          player: me,
          game: g.pubkey,
          vault: vaultPda(g.pubkey),
          playerHand: handPda(g.pubkey, me),
        })
      ).tx.instructions[0];
      await setUpHand({ connection, wallet, game: g, prependIxs: [joinIx] });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const join = joinAndDelegate;

  // Host: start the game AND delegate the game PDA in one wallet tx, then enter.
  const startAndEnter = async (g: GameSummary) => {
    setBusy(g.pubkey.toBase58());
    try {
      const { identity } = await teeValidator();
      const startIx = (await buildStartGame(program, { host: me, game: g.pubkey })).tx.instructions[0];
      const delegateGameIx = await buildDelegateGameIx(program, {
        payer: me,
        host: g.host,
        game: g.pubkey,
        gameId: g.gameId,
        validatorIdentity: identity,
      });
      const tx = new Transaction().add(startIx, delegateGameIx);
      await sendWalletTx(connection, wallet, tx, { label: "Start + delegate game" });
      onEnter(g);
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="screen">
      <h2 className="title">TABLES</h2>

      {showForm ? (
        <div className="card create-form">
          <h3 className="section-head no-border">New Table</h3>
          <label className="field">
            <span className="field-lbl">Entry fee (SOL)</span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              value={entryFee}
              onChange={(e) => setEntryFee(e.target.value)}
              disabled={busy === "create"}
            />
            <span className="field-hint">Each player pays this into the pot on join.</span>
          </label>
          <label className="field">
            <span className="field-lbl">Turn timer (seconds)</span>
            <input
              className="input"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={graceSeconds}
              onChange={(e) => setGraceSeconds(e.target.value)}
              disabled={busy === "create"}
            />
            <span className="field-hint">Grace before a stalling player can be timed out.</span>
          </label>
          {formError && <div className="tx-error">{formError}</div>}
          <div className="row form-actions">
            <button className="btn small ghost" onClick={() => { setShowForm(false); setFormError(null); }} disabled={busy === "create"}>
              Cancel
            </button>
            <button className="btn small" onClick={create} disabled={busy === "create"}>
              {busy === "create" ? "Creating…" : "Create & Join"}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn" onClick={() => setShowForm(true)} disabled={!!busy}>
          New Table
        </button>
      )}

      {/* ── Open tables: joinable / startable ── */}
      <section className="section">
        <h3 className="section-head">Open Tables <span className="count">{waiting.length}</span></h3>
        <div className="list">
          {waiting.map((g) => {
            const isHost = g.host.equals(me);
            const joined = g.players.some((p) => p.equals(me));
            return (
              <div className="card row clickable" key={g.pubkey.toBase58()}
                onClick={() => setDetail(g)}>
                <div className="stack">
                  <div className="mono">{short(g.pubkey)}</div>
                  <div className="muted">
                    {g.players.length} in · {sol(g.entryFeeLamports)} SOL entry
                  </div>
                </div>
                {isHost && !joined ? (
                  // Ghost table: host created it but never joined/delegated (e.g. an
                  // old flow where the delegate tx was rejected). Let them recover.
                  <button className="btn small" disabled={!!busy}
                    onClick={(e) => { e.stopPropagation(); joinAndDelegate(g); }}>Join</button>
                ) : isHost ? (
                  <button className="btn small" disabled={g.players.length < 2 || !!busy}
                    onClick={(e) => { e.stopPropagation(); startAndEnter(g); }}>Start</button>
                ) : joined ? (
                  <span className="muted">joined ✓</span>
                ) : (
                  <button className="btn small" disabled={!!busy}
                    onClick={(e) => { e.stopPropagation(); join(g); }}>Join</button>
                )}
              </div>
            );
          })}
          {waiting.length === 0 && <div className="muted">No open tables. Create one.</div>}
        </div>
      </section>

      {/* ── Ongoing games: live details ── */}
      <section className="section">
        <h3 className="section-head">Ongoing <span className="count live">{active.length}</span></h3>
        <div className="list">
          {active.map((g) => {
            const seat = g.players.findIndex((p) => p.equals(me));
            const iAmIn = seat >= 0 && g.activeSeats[seat];
            const yourTurn = iAmIn && g.currentTurn === seat;
            return (
              <div className="card game-detail clickable" key={g.pubkey.toBase58()}
                onClick={() => setDetail(g)}>
                <div className="row">
                  <div className="stack">
                    <div className="mono">{short(g.pubkey)}</div>
                    <div className="muted">host {short(g.host)}</div>
                  </div>
                  <span className={"badge phase-" + g.phase.toLowerCase()}>{g.phase}</span>
                </div>
                <div className="stat-grid">
                  <div><span className="stat-num">{g.activeSeats.filter(Boolean).length}</span><span className="stat-lbl">alive</span></div>
                  <div><span className="stat-num">{g.round}</span><span className="stat-lbl">round</span></div>
                  <div><span className="stat-num gold">{sol(g.potLamports)}</span><span className="stat-lbl">pot SOL</span></div>
                </div>
                <div className="muted center-text">
                  {g.currentBid
                    ? `Bid: ${g.currentBid.quantity} × ${g.currentBid.face}`
                    : "No bid yet"}
                </div>
                {iAmIn && (
                  <button className="btn small full" disabled={!!busy}
                    onClick={(e) => { e.stopPropagation(); onEnter(g); }}>
                    {yourTurn ? "Your turn — Resume" : "Resume"}
                  </button>
                )}
              </div>
            );
          })}
          {active.length === 0 && <div className="muted">No games in progress.</div>}
        </div>
      </section>

      {/* ── Results: ended games ── */}
      <section className="section">
        <h3 className="section-head">Results <span className="count">{ended.length}</span></h3>
        <div className="list">
          {ended.map((g) => {
            const iWon = g.winner ? g.winner.equals(me) : false;
            return (
              <div className={"card row result clickable" + (iWon ? " won" : "")} key={g.pubkey.toBase58()}
                onClick={() => setDetail(g)}>
                <div className="stack">
                  <div className="mono">{short(g.pubkey)}</div>
                  <div className="muted">
                    {g.winner ? <>🏆 {iWon ? "You won" : short(g.winner)}</> : "resolving…"}
                  </div>
                </div>
                <div className="stack right">
                  <div className="balance small-bal">{sol(g.potLamports)} SOL</div>
                  <div className="muted">{g.players.length} players</div>
                </div>
              </div>
            );
          })}
          {ended.length === 0 && <div className="muted">No finished games yet.</div>}
        </div>
      </section>

      {detail && (() => {
        // Resolve the freshest copy so pot/round/bid stay live while open.
        const g = games.find((x) => x.pubkey.equals(detail.pubkey)) ?? detail;
        const alive = g.activeSeats.filter(Boolean).length;
        const mySeat = g.players.findIndex((p) => p.equals(me));
        const copy = () => navigator.clipboard?.writeText(g.pubkey.toBase58());
        return (
          <div className="modal-overlay" onClick={() => setDetail(null)}>
            <div className="modal card game-detail" onClick={(e) => e.stopPropagation()}>
              <div className="row">
                <h3 className="section-head no-border">Table Details</h3>
                <button className="btn small ghost" onClick={() => setDetail(null)}>Close</button>
              </div>

              <div className="row">
                <div className="stack">
                  <div className="mono link" onClick={copy} title="Copy address">{short(g.pubkey)} ⧉</div>
                  <div className="muted">host {g.host.equals(me) ? "you" : short(g.host)}</div>
                </div>
                <div className="stack right">
                  <span className={"badge phase-" + g.phase.toLowerCase()}>
                    {g.status === "Waiting" ? "Waiting" : g.status === "Ended" ? "Ended" : g.phase}
                  </span>
                </div>
              </div>

              <div className="stat-grid">
                <div><span className="stat-num">{g.players.length}</span><span className="stat-lbl">seats</span></div>
                <div><span className="stat-num">{alive}</span><span className="stat-lbl">alive</span></div>
                <div><span className="stat-num">{g.round}</span><span className="stat-lbl">round</span></div>
                <div><span className="stat-num gold">{sol(g.potLamports)}</span><span className="stat-lbl">pot SOL</span></div>
              </div>

              <div className="muted center-text">
                Entry {sol(g.entryFeeLamports)} SOL ·{" "}
                {g.currentBid ? `Bid ${g.currentBid.quantity} × ${g.currentBid.face}` : "No bid yet"}
              </div>

              <div className="stack detail-players">
                <div className="stat-lbl">Players</div>
                {g.players.map((p, i) => {
                  const isMe = p.equals(me);
                  const isAlive = g.activeSeats[i];
                  const turn = g.status === "Active" && g.currentTurn === i;
                  const won = g.winner?.equals(p);
                  return (
                    <div className="row detail-player" key={p.toBase58()}>
                      <span className="mono">
                        {isMe ? "you" : short(p)}
                        {p.equals(g.host) ? " · host" : ""}
                      </span>
                      <span className="muted">
                        {won ? "🏆 winner" : turn ? "● turn" : isAlive ? "alive" : "out"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {g.status === "Waiting" && (
                g.host.equals(me) && !g.players.some((p) => p.equals(me)) ? (
                  <button className="btn small full" disabled={!!busy}
                    onClick={() => { setDetail(null); joinAndDelegate(g); }}>Join</button>
                ) : g.host.equals(me) ? (
                  <button className="btn small full" disabled={g.players.length < 2 || !!busy}
                    onClick={() => { setDetail(null); startAndEnter(g); }}>
                    {g.players.length < 2 ? "Need 2+ players to start" : "Start"}
                  </button>
                ) : g.players.some((p) => p.equals(me)) ? (
                  <div className="muted center-text">joined ✓ — waiting for host to start</div>
                ) : (
                  <button className="btn small full" disabled={!!busy}
                    onClick={() => { setDetail(null); join(g); }}>Join</button>
                )
              )}
              {g.status === "Active" && mySeat >= 0 && g.activeSeats[mySeat] && (
                <button className="btn small full" disabled={!!busy}
                  onClick={() => { setDetail(null); onEnter(g); }}>Resume</button>
              )}
            </div>
          </div>
        );
      })()}
    </main>
  );
}
