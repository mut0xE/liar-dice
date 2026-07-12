import { useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { resolveSpectateEndpoint } from "../chain/enter";
import { useSpectateGameState } from "../hooks/useSpectateGameState";
import { GameSummary } from "../chain/games";
import { Dice } from "../ui/Dice";
import { avatarPos } from "../ui/avatar";
import { copyAddress } from "../ui/format";
import { countFace, dieMatches } from "../chain/bidRules";
import { MISS_LIMIT, short, playerName, sol, enumKey, useCountdown, BidBadge } from "../ui/tableDisplay";

type RoundResult = {
  round: number;
  bid: { quantity: number; face: number; bidder: number };
  challenger: number;
  actual: number;
  loser: number;
  bidHeld: boolean;
  reveals: any[];
};

// Read-only mirror of GameTable for a wallet that isn't seated at this table. No
// hand, no session, no delegation — just the reader identity's public reads, so
// opening a table to watch never asks a bystander to sign anything or spend rent.
export function SpectateTable({
  game,
  me,
  onExit,
}: {
  game: GameSummary;
  me: PublicKey;
  onExit: () => void;
}) {
  if (game.status === "Waiting") {
    return (
      <main className="screen center-screen">
        <div className="ribbon"><div className="band">Liar's Dice</div></div>
        <div className="muted" style={{ marginTop: 20 }}>This table hasn't cast off yet — nothing to watch until it starts.</div>
        <button className="btn small ghost full" onClick={onExit} style={{ marginTop: 14, maxWidth: 220 }}>Back to Tables</button>
      </main>
    );
  }
  if (game.status === "Ended") return <SpectateResult game={game} onExit={onExit} />;
  return <SpectateActive game={game} me={me} onExit={onExit} />;
}

function SpectateResult({ game, onExit }: { game: GameSummary; onExit: () => void }) {
  return (
    <main className="screen game-screen">
      <TableHeader game={game} watching />
      <section className="table-action">
        <h3 className="section-head no-border">Game Over</h3>
        <div className="card compact-card">
          {game.winner ? (
            <>Winner: <span className="mono copyable" onClick={() => copyAddress(game.winner!)}>{short(game.winner)}</span></>
          ) : "Winner resolving…"}
        </div>
        <div className="muted">The pot was already settled between the players.</div>
        <button className="btn small ghost full" onClick={onExit}>Back to Tables</button>
      </section>
    </main>
  );
}

function TableHeader({ game, watching }: { game: GameSummary; watching?: boolean }) {
  return (
    <section className="table-top">
      <div className="table-ident">
        <span className="stat-lbl">Table</span>
        <span className="table-code mono copyable" onClick={() => copyAddress(game.pubkey)}>{short(game.pubkey)}</span>
      </div>
      {watching && <span className="spectate-badge">🔭 Watching</span>}
      <div className="table-pot">
        <span className="stat-lbl">Pot</span>
        <span className="balance">{sol(game.potLamports.toNumber())} SOL</span>
      </div>
    </section>
  );
}

function SpectateActive({
  game,
  me,
  onExit,
}: {
  game: GameSummary;
  me: PublicKey;
  onExit: () => void;
}) {
  const [fqdn, setFqdn] = useState<string | null>(null);
  const [status, setStatus] = useState("Finding the table…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    resolveSpectateEndpoint(game.pubkey)
      .then(({ fqdn }) => {
        setFqdn(fqdn);
        setStatus("Ready.");
      })
      .catch((e) => setStatus("Error: " + ((e as Error).message ?? String(e))));
  }, [game.pubkey]);

  if (!fqdn) {
    return (
      <main className="screen game-screen">
        <TableHeader game={game} watching />
        <section className="table-setup">
          <span className="spinner-dot" aria-hidden="true" />
          <h3 className="section-head no-border">Finding the table</h3>
          <div className={status.startsWith("Error") ? "tx-error" : "muted"}>{status}</div>
        </section>
      </main>
    );
  }

  return (
    <main className="screen game-screen">
      <LiveSpectate game={game} me={me} fqdn={fqdn} onExit={onExit} />
    </main>
  );
}

function LiveSpectate({
  game,
  me,
  fqdn,
  onExit,
}: {
  game: GameSummary;
  me: PublicKey;
  fqdn: string;
  onExit: () => void;
}) {
  const { game: g } = useSpectateGameState(fqdn, game.pubkey);
  const [history, setHistory] = useState<RoundResult[]>([]);
  const pendingShowdown = useRef<RoundResult | null>(null);
  const loggedRound = useRef<number>(-1);

  const phase = enumKey(g?.phase, game.phase).toLowerCase();
  const status = enumKey(g?.status, game.status).toLowerCase();
  const round = Number(g?.round ?? game.round);
  const deadline = Number(g?.actionDeadline ?? 0);
  const countdown = useCountdown(deadline);
  const deadlinePassed = deadline !== 0 && Date.now() / 1000 > deadline;
  const players: PublicKey[] = g?.players ?? game.players;
  const active: boolean[] = g?.isActive ?? game.activeSeats;
  const diceCounts: number[] = (g?.diceCounts ?? players.map((_, i) => (active[i] ? 5 : 0))).map((d: number) => Number(d));
  const participating: boolean[] = g?.participating ?? [];
  const missedRolls: number[] = (g?.missedRolls ?? []).map((m: number) => Number(m));
  const totalDice = diceCounts.reduce((a, b) => a + b, 0);
  const previousBid = g?.currentBid
    ? { quantity: Number(g.currentBid.quantity), face: Number(g.currentBid.face) }
    : null;
  const participatingCount = g ? (g.participating as boolean[]).filter(Boolean).length : 0;
  const allRevealed = g ? (g.lastReveal?.length ?? 0) >= participatingCount && participatingCount > 0 : false;
  const winnerIdx = active.findIndex(Boolean);
  const winner = status === "ended" && winnerIdx >= 0 ? players[winnerIdx] : null;

  // Same chain-derived history capture as the live table, so a spectator's log
  // matches every player's exactly — nobody is trusting anybody else's client.
  useEffect(() => {
    if (!g) return;
    const makeResult = (): RoundResult | null => {
      if (!g.currentBid) return null;
      const bid = { quantity: Number(g.currentBid.quantity), face: Number(g.currentBid.face), bidder: Number(g.currentBid.bidder) };
      const reveals = [...(g.lastReveal ?? [])];
      const actual = countFace(reveals.map((r: any) => (r.dice as number[]).slice(0, Number(r.diceCount))), bid.face);
      const challenger = Number(g.challenger);
      const bidHeld = actual >= bid.quantity;
      return { round, bid, challenger, actual, loser: bidHeld ? challenger : bid.bidder, bidHeld, reveals };
    };
    if (phase === "revealing" && allRevealed) {
      const r = makeResult();
      if (r) pendingShowdown.current = r;
    }
    const snap = pendingShowdown.current;
    if (snap && round > snap.round && loggedRound.current !== snap.round) {
      loggedRound.current = snap.round;
      setHistory((prev) => [snap, ...prev].slice(0, 12));
      pendingShowdown.current = null;
    }
  }, [g, phase, allRevealed, round]);

  const phaseLabel = status === "ended" ? "ended" : phase;
  const urgent = countdown.left !== null && countdown.left > 0 && countdown.left <= 10;

  return (
    <>
      <section className="table-console">
        <div className="console-ident">
          <span className="console-code mono copyable" onClick={() => copyAddress(game.pubkey)}>{short(game.pubkey)}</span>
          <span className="spectate-badge">🔭 Watching</span>
          <span className="console-pot">{sol(game.potLamports.toNumber())} SOL</span>
        </div>
        {status !== "ended" && (
          <div className="console-stats">
            <div className="hud-cell"><span className="hud-k">Round</span><strong>{round}</strong></div>
            <div className="hud-cell"><span className="hud-k">Phase</span><strong className={`ph-${phaseLabel}`}>{phaseLabel}</strong></div>
            <div className="hud-cell"><span className="hud-k">Bid</span><BidBadge bid={previousBid} /></div>
            <div className={`hud-cell hud-timer${urgent ? " urgent" : ""}`}>
              <span className="hud-k">Timer</span>
              <strong>{countdown.label}</strong>
            </div>
          </div>
        )}
      </section>

      <section className="table-layout">
        <div className="player-rail">
          <div className="crew-row">
            {players.map((p, i) => {
              const isTurn = Number(g?.currentTurn) === i && status !== "ended";
              return (
                <div
                  key={p.toBase58()}
                  className={`crew-chip ghost${isTurn ? " turn" : ""}${active[i] ? "" : " out"}`}
                  title={p.toBase58()}
                >
                  <span className="crew-avatar" style={avatarPos(i)}>
                    <span className={`crew-dice${active[i] ? "" : " gone"}`}>{diceCounts[i] ?? 0}</span>
                  </span>
                  <span className="crew-name">{short(p)}</span>
                  <span className="crew-status">
                    {!active[i]
                      ? (missedRolls[i] ?? 0) >= MISS_LIMIT
                        ? `struck out ${missedRolls[i]}/${MISS_LIMIT}`
                        : "out"
                      : isTurn
                        ? "turn"
                        : (missedRolls[i] ?? 0) > 0
                          ? `strike ${missedRolls[i]}/${MISS_LIMIT}`
                          : phase === "rolling"
                            ? "rolling"
                            : participating[i] ? "in round" : ""}
                  </span>
                </div>
              );
            })}
            <div className="crew-chip total-chip" aria-label={`${totalDice} total dice`}>
              <span className="crew-avatar total">🎲</span>
              <span className="crew-name">{totalDice} dice</span>
              <span className="crew-status">on table</span>
            </div>
          </div>
          <SpectateHistory history={history} players={players} />
        </div>

        <section className="table-action">
          {status === "ended" ? (
            <>
              <h3 className="section-head no-border">Game Over</h3>
              <div className="card compact-card">
                {winner ? <>Winner: <span className="mono copyable" onClick={() => copyAddress(winner)}>{short(winner)}</span></> : "Winner resolving…"}
              </div>
              <button className="btn small ghost full" onClick={onExit}>Back to Tables</button>
            </>
          ) : phase === "rolling" ? (
            <>
              <h3 className="section-head no-border">Rolling</h3>
              <div className="muted">Every dice roll stays private on the TEE until someone challenges it — even to a spectator.</div>
              <div className="auto-status">
                <span className="spinner-dot" />
                {deadlinePassed ? "Roll window closed — opening bidding…" : "Waiting for the table to roll…"}
              </div>
            </>
          ) : phase === "bidding" ? (
            <>
              <h3 className="section-head no-border">Bidding</h3>
              <div className="muted">Waiting for {playerName(Number(g?.currentTurn ?? 0), players, me)}.</div>
              <BidBadge bid={previousBid} />
            </>
          ) : phase === "revealing" ? (
            <SpectateReveal
              reveals={g?.lastReveal ?? []}
              count={participatingCount}
              bid={previousBid}
              challenger={Number(g?.challenger ?? 0)}
              players={players}
              me={me}
            />
          ) : null}
        </section>
      </section>
    </>
  );
}

function SpectateReveal({
  reveals,
  count,
  bid,
  challenger,
  players,
  me,
}: {
  reveals: any[];
  count: number;
  bid: { quantity: number; face: number } | null;
  challenger: number;
  players: PublicKey[];
  me: PublicKey;
}) {
  const allIn = reveals.length >= count && count > 0;
  const actual = bid
    ? countFace(reveals.map((r: any) => (r.dice as number[]).slice(0, Number(r.diceCount))), bid.face)
    : 0;
  return (
    <>
      <h3 className="section-head no-border">Showdown</h3>
      {bid && <div className="muted challenged-bid">Challenged bid: <BidBadge bid={bid} /> · Challenger: {playerName(challenger, players, me)}</div>}
      <div className="muted">Reveals {reveals.length}/{count}</div>
      {bid && allIn && <SpectateTally reveals={reveals} face={bid.face} target={actual} />}
      {reveals.map((r, i) => (
        <div className="reveal-row" key={`${Number(r.playerIdx)}-${i}`}>
          <div className="reveal-seat">
            <span className="mono">{playerName(Number(r.playerIdx), players, me)}</span>
            <small>{Number(r.diceCount)} dice</small>
          </div>
          <div className="dice-row">
            {(r.dice as number[]).slice(0, Number(r.diceCount)).map((d, j) => (
              <Dice key={j} value={d} delay={j * 60} highlight={bid ? dieMatches(Number(d), bid.face) : false} wild={bid ? Number(d) === 1 && bid.face !== 1 : false} />
            ))}
          </div>
        </div>
      ))}
      <div className="auto-status">
        <span className="spinner-dot" />
        {allIn ? "All dice in — settling shortly…" : "Waiting for players to reveal…"}
      </div>
    </>
  );
}

// Same animated tally as the live table's FaceTally, kept local since spectate
// never needs the busy-state plumbing the player view carries alongside it.
function SpectateTally({ reveals, face, target }: { reveals: any[]; face: number; target: number }) {
  const total = reveals.reduce((n, r) => n + Number(r.diceCount), 0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    if (target <= 0) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= target) clearInterval(id);
    }, 380);
    return () => clearInterval(id);
  }, [target, face, total]);
  return (
    <div className="face-tally">
      <div className="tally-count">
        <Dice value={face} />
        <span className="tally-num" key={shown}>{shown}</span>
      </div>
      <div className="tally-pips">
        {Array.from({ length: Math.max(target, 0) }).map((_, k) => (
          <span key={k} className={`tally-pip ${k < shown ? "lit" : ""}`} />
        ))}
      </div>
      <small className="muted">counting {face}s across {total} dice…</small>
    </div>
  );
}

function SpectateHistory({ history, players }: { history: RoundResult[]; players: PublicKey[] }) {
  if (history.length === 0) return null;
  const name = (idx: number) => {
    const p = players[idx];
    return p ? short(p) : `#${idx}`;
  };
  return (
    <div className="history-board">
      <div className="stat-lbl history-head">Past Rounds</div>
      {history.map((h) => {
        const winner = h.bidHeld ? h.bid.bidder : h.challenger;
        return (
          <div className="history-row" key={h.round}>
            <span className="mono history-round">R{h.round}</span>
            <span className="history-bid">
              <BidBadge bid={h.bid} />
              <small>{h.actual} shown</small>
            </span>
            <span className="history-outcome">
              <span className="win">▲ {name(winner)}</span>
              <span className="lose">▼ {name(h.loser)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
