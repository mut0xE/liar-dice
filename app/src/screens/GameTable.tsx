import { useEffect, useMemo, useRef, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet } from "../wallet/useAnchorWallet";
import { useWalletStatus } from "../wallet/useWalletStatus";
import { sessionErConnection } from "../chain/connection";
import { pushToast } from "../ui/toast";
import { programOn } from "../chain/program";
import { handPda, vaultPda } from "../chain/pdas";
import { setUpHand, resolveGameplayEndpoint, ensureHandPermission, closeHandPermission } from "../chain/enter";
import { isAccountDelegated } from "../chain/delegation";
import { GameSummary } from "../chain/games";
import { useGameState } from "../hooks/useGameState";
import { useMyHand } from "../hooks/useMyHand";
import { Dice } from "../ui/Dice";
import {
  buildBeginBidding,
  buildChallenge,
  buildEndGameSession,
  buildForceTimeout,
  buildPlaceBid,
  buildRequestRoll,
  buildReveal,
  buildSettleRound,
} from "../chain/builders";
import { sendSessionTx } from "../chain/sendSession";
import { validateBid, countFace, dieMatches } from "../chain/bidRules";
import { avatarPos } from "../ui/avatar";
import { copyAddress } from "../ui/format";
import { MISS_LIMIT, short, playerName, sol, enumKey, useCountdown, BidBadge } from "../ui/tableDisplay";
import { SpectateTable } from "./SpectateTable";

type Ready = {
  session: Keypair;
  sessionToken: PublicKey;
  fqdn: string;
  validatorIdentity: PublicKey;
};

type RoundResult = {
  round: number;
  bid: { quantity: number; face: number; bidder: number };
  challenger: number;
  actual: number;
  loser: number;
  bidHeld: boolean;
  reveals: any[];
};

export function GameTable({
  game,
  onExit,
}: {
  game: GameSummary;
  onExit: () => void;
}) {
  const { connection } = useConnection();
  const { signMessage, publicKey } = useWallet();
  const wallet = useAnchorWallet();
  const [ready, setReady] = useState<Ready | null>(null);
  const [status, setStatus] = useState("Preparing table…");
  const [details, setDetails] = useState<string[]>([]);
  const ran = useRef(false);
  // A wallet that isn't seated at this table never joined it — there's no hand to
  // delegate or session to open for them, only a game to watch. Route them to the
  // read-only view before any of the below tries to set up gameplay on their behalf.
  const isSeated = Boolean(publicKey && game.players.some((p) => p.equals(publicKey)));
  // Cancelled games are provably never delegated (cancel_game only runs on a
  // Waiting table) — always safe to show the static summary, no ER round trip.
  // Ended is ambiguous: `settle_round` flips status to Ended WHILE STILL ON THE
  // ER, before the winner has claimed — end_game (the claim) is what commits +
  // undelegates it. Skipping straight to a static summary there would hide the
  // Claim Prize button for a winner who hasn't claimed yet. So for Ended we check
  // the actual on-chain delegation state before deciding.
  const [endedStillOnEr, setEndedStillOnEr] = useState<boolean | null>(null);
  useEffect(() => {
    if (game.status !== "Ended") return;
    let cancelled = false;
    isAccountDelegated(game.pubkey).then((delegated) => {
      if (!cancelled) setEndedStillOnEr(delegated);
    });
    return () => {
      cancelled = true;
    };
  }, [game.status, game.pubkey]);
  const checkingEnded = game.status === "Ended" && endedStillOnEr === null;
  const isStaleOver = game.status === "Cancelled" || (game.status === "Ended" && endedStillOnEr === false);

  useEffect(() => {
    if (!isSeated || checkingEnded || isStaleOver) return;
    if (wallet && (!signMessage || !publicKey)) {
      setStatus("This wallet must support message signing for MagicBlock private dice.");
      return;
    }
    if (!wallet || !signMessage || !publicKey || ran.current) return;
    ran.current = true;
    (async () => {
      const hand = handPda(game.pubkey, wallet.publicKey);
      const setup = await setUpHand({
        connection,
        wallet,
        game,
        onStatus: setStatus,
        onDetail: (line) => setDetails((prev) => [...prev, line]),
      });

      setStatus("Finding game table…");
      const { fqdn } = await resolveGameplayEndpoint(game.pubkey, hand);
      setDetails((prev) => [...prev, `er ${fqdn.replace(/^https?:\/\//, "")}`]);
      setReady({ ...setup, fqdn, validatorIdentity: setup.identity });
      setStatus("Ready.");
    })().catch((e) => setStatus("Error: " + ((e as Error).message ?? String(e))));
  }, [isSeated, checkingEnded, isStaleOver, wallet, signMessage, publicKey, connection, game]);

  if (!isSeated) return <SpectateTable game={game} me={publicKey!} onExit={onExit} />;
  if (isStaleOver) return <ResumeGameOverPanel game={game} onExit={onExit} />;

  return (
    <main className="screen game-screen">
      {checkingEnded || !ready ? (
        <>
          <TableHeader game={game} />
          <SetupPanel status={checkingEnded ? "Checking table status…" : status} details={details} />
        </>
      ) : (
        <LiveGameTable game={game} ready={ready} onExit={onExit} />
      )}
    </main>
  );
}

function ResumeGameOverPanel({ game, onExit }: { game: GameSummary; onExit: () => void }) {
  const cancelled = game.status === "Cancelled";
  return (
    <main className="screen game-screen">
      <TableHeader game={game} />
      <section className="table-action">
        <h3 className="section-head no-border">{cancelled ? "Table Cancelled" : "Game Over"}</h3>
        <div className="card compact-card">
          {cancelled ? (
            "This table was cancelled — no round was settled."
          ) : game.winner ? (
            <>Winner: <span className="mono copyable" onClick={() => copyAddress(game.winner!)}>{short(game.winner)}</span></>
          ) : (
            "Winner resolving…"
          )}
        </div>
        <div className="muted">The pot was already settled between the players.</div>
        <button className="btn small ghost full" onClick={onExit}>Back to Tables</button>
      </section>
    </main>
  );
}

function TableHeader({ game }: { game: GameSummary }) {
  return (
    <section className="table-top">
      <div className="table-ident">
        <span className="stat-lbl">Table</span>
        <span className="table-code mono copyable" onClick={() => copyAddress(game.pubkey)}>{short(game.pubkey)}</span>
      </div>
      <div className="table-pot">
        <span className="stat-lbl">Pot</span>
        <span className="balance">{sol(game.potLamports.toNumber())} SOL</span>
      </div>
    </section>
  );
}

function SetupPanel({ status, details }: { status: string; details: string[] }) {
  const isError = status.startsWith("Error");
  return (
    <section className="table-setup">
      <span className="spinner-dot" aria-hidden="true" />
      <h3 className="section-head no-border">Getting the table ready</h3>
      <div className={isError ? "tx-error" : "muted"}>{status}</div>
      {details.length > 0 && (
        <div className="rollup-status compact">
          {details.slice(-3).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </section>
  );
}

function LiveGameTable({
  game,
  ready,
  onExit,
}: {
  game: GameSummary;
  ready: Ready;
  onExit: () => void;
}) {
  const wallet = useAnchorWallet();
  const { signMessage, publicKey } = useWallet();
  const walletStatus = useWalletStatus();
  const { game: g, refresh: refreshGame } = useGameState(ready.fqdn, game.pubkey);
  // Memoize by base58 so `hand` keeps a stable object identity across renders.
  // handPda() mints a fresh PublicKey each call; passing that straight into
  // useMyHand would change its refresh() identity every render and spin an
  // infinite fetch→setState→render loop (hammering the ER with 429s).
  const hand = useMemo(
    () => (wallet ? handPda(game.pubkey, wallet.publicKey) : game.pubkey),
    [wallet?.publicKey.toBase58(), game.pubkey],
  );
  const handState = useMyHand(ready.fqdn, hand, ready.session);
  const [qty, setQty] = useState(1);
  const [face, setFace] = useState(2);
  const [err, setErr] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  // Running log of settled showdowns, captured straight from chain state so every
  // client records the same history (not just whoever happened to send settle).
  const [history, setHistory] = useState<RoundResult[]>([]);
  // Latest fully-revealed showdown, stashed until the round advances and we log it.
  const pendingShowdown = useRef<RoundResult | null>(null);
  const loggedRound = useRef<number>(-1);
  // After a bid/challenge lands, remember which turn we acted on so the action
  // buttons stay disabled until the on-chain turn actually moves off us — closes
  // the gap where `busy` clears before state propagates and a double-submit slips in.
  const [actedTurn, setActedTurn] = useState<number | null>(null);
  // Which crew avatar is expanded to show its full wallet address.
  const [openSeat, setOpenSeat] = useState<number | null>(null);
  // Claimed state survives remounts (poll hiccups, navigation) via localStorage,
  // so the Claim button can't reappear after the pot already moved.
  const claimedKey = `liar-dice:claimed:${game.pubkey.toBase58()}`;
  const [paid, setPaidState] = useState(() => {
    try { return globalThis.localStorage?.getItem(claimedKey) === "1"; } catch { return false; }
  });
  const setPaid = (v: boolean) => {
    setPaidState(v);
    try { if (v) globalThis.localStorage?.setItem(claimedKey, "1"); } catch { /* hint only */ }
  };
  const revealRound = useRef<number | null>(null);
  const settleRound = useRef<number | null>(null);

  const phase = enumKey(g?.phase, game.phase).toLowerCase();
  const status = enumKey(g?.status, game.status).toLowerCase();
  const round = Number(g?.round ?? game.round);
  const deadline = Number(g?.actionDeadline ?? 0);
  const countdown = useCountdown(deadline);
  const deadlinePassed = deadline !== 0 && Date.now() / 1000 > deadline;
  const players: PublicKey[] = g?.players ?? game.players;
  const active: boolean[] = g?.isActive ?? game.activeSeats;
  const diceCounts: number[] = (g?.diceCounts ?? players.map((_, i) => active[i] ? 5 : 0)).map((d: number) => Number(d));
  const participating: boolean[] = g?.participating ?? [];
  const missedRolls: number[] = (g?.missedRolls ?? []).map((m: number) => Number(m));
  const totalDice = diceCounts.reduce((a, b) => a + b, 0);
  const mySeat = wallet ? players.findIndex((p) => p.equals(wallet.publicKey)) : -1;
  const myTurn = g && Number(g.currentTurn) === mySeat;
  // Locked while our just-submitted action hasn't propagated (turn still on us).
  const actionLocked = actedTurn !== null && g != null && Number(g.currentTurn) === actedTurn;
  const rolledThisRound = Boolean(handState.rolled && handState.rolledRound === round);
  const previousBid = useMemo(() => {
    const b = g?.currentBid;
    return b ? { quantity: Number(b.quantity), face: Number(b.face) } : null;
  }, [g]);
  const participatingCount = g ? (g.participating as boolean[]).filter(Boolean).length : 0;
  const allRevealed = g ? (g.lastReveal?.length ?? 0) >= participatingCount && participatingCount > 0 : false;
  const canSettle = phase === "revealing" && (allRevealed || deadlinePassed);
  const s = wallet
    ? { sessionSigner: ready.session, authority: wallet.publicKey, sessionToken: ready.sessionToken }
    : null;

  const makeRoundResult = (): RoundResult | null => {
    if (!g?.currentBid) return null;
    const bid = {
      quantity: Number(g.currentBid.quantity),
      face: Number(g.currentBid.face),
      bidder: Number(g.currentBid.bidder),
    };
    const reveals = [...(g.lastReveal ?? [])];
    // Wild-1 aware, to match the on-chain settle count (1s are wild unless bidding 1s).
    const actual = countFace(
      reveals.map((r: any) => (r.dice as number[]).slice(0, Number(r.diceCount))),
      bid.face
    );
    const challenger = Number(g.challenger);
    const bidHeld = actual >= bid.quantity;
    return {
      round,
      bid,
      challenger,
      actual,
      loser: bidHeld ? challenger : bid.bidder,
      bidHeld,
      reveals,
    };
  };

  const withProgram = async () => {
    const conn = await sessionErConnection(ready.fqdn, ready.session);
    return { conn, program: programOn(conn, wallet!) };
  };

  // Refetch a few times right after an action lands, faster than the 2s poll.
  const pullSoon = () => {
    [150, 500, 1100].forEach((ms) => setTimeout(() => { void refreshGame(); }, ms));
  };

  // Make dice private lazily on the first action (deferred out of table setup).
  // Idempotent + guarded, so it only ever sends one "Make dice private" tx.
  const permEnsured = useRef(false);
  const ensurePrivate = async (conn: Awaited<ReturnType<typeof withProgram>>) => {
    if (permEnsured.current || !wallet) return;
    await ensureHandPermission(
      conn.conn,
      conn.program,
      { session: ready.session, authority: wallet.publicKey, sessionToken: ready.sessionToken },
      hand
    );
    permEnsured.current = true;
  };

  const explain = (e: unknown): string => {
    const m = (e as Error)?.message ?? String(e);
    if (/DeadlineNotReached|6021/.test(m)) return "Waiting for the roll window to close.";
    return m;
  };

  // Anchor custom error code from a reverted-tx message, else null.
  const errCode = (e: unknown): number | null => {
    const m = (e as Error)?.message ?? String(e);
    const match = /custom program error: (\d+)|\(code (\d+)\)/.exec(m);
    return match ? Number(match[1] ?? match[2]) : null;
  };
  // "Someone else already did this / phase moved on" — benign for auto actions.
  // 6016 DuplicateHand, 6018 NotSettled, 6001 BadGameState.
  const isBenignRace = (e: unknown) => {
    const c = errCode(e);
    return c === 6016 || c === 6018 || c === 6001;
  };

  const roll = async () => {
    if (!wallet || !s) return;
    setBusy("roll");
    setTxError(null);
    try {
      const ctx = await withProgram();
      const { conn, program } = ctx;
      // Dice must be private BEFORE the roll writes them, or there's a brief window
      // where the rolled dice are world-readable on the ER.
      await ensurePrivate(ctx);
      const tx = await buildRequestRoll(program, s, {
        game: game.pubkey,
        playerHand: hand,
        clientSeed: Math.floor(Math.random() * 256),
      });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Roll dice");
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 700));
        if (await handState.refresh(round)) break;
      }
    } catch (e) {
      setTxError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  const forceOpen = async () => {
    if (!s || !g) return;
    setTxError(null);
    setBusy("open");
    try {
      const { conn, program } = await withProgram();
      const hands = players.map((p) => handPda(game.pubkey, p));
      const tx = await buildBeginBidding(program, s, { game: game.pubkey, hands });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Open bidding");
    } catch (e) {
      setTxError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  // Quiet, automatic version of begin_bidding used to advance out of the Rolling
  // phase. Only the program can see who has rolled (hands are TEE-private), so we
  // just poll: begin_bidding SUCCEEDS once everyone rolled (fast path) or the roll
  // window expired (skips + strikes no-shows). Until then it reverts benignly and
  // we swallow it — no toast, no error line, bidding inputs stay hidden.
  const autoBeginInFlight = useRef(false);
  const autoBegin = async () => {
    if (!s || !g || autoBeginInFlight.current) return;
    autoBeginInFlight.current = true;
    try {
      const { conn, program } = await withProgram();
      const hands = players.map((p) => handPda(game.pubkey, p));
      const tx = await buildBeginBidding(program, s, { game: game.pubkey, hands });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Open bidding", { quiet: true });
      pullSoon();
    } catch {
      // Not everyone has rolled yet (or another client opened first) — retry next tick.
    } finally {
      autoBeginInFlight.current = false;
    }
  };

  const bid = async () => {
    if (!s) return;
    const v = validateBid(previousBid, { quantity: qty, face });
    if (!v.ok) {
      setErr(v.reason);
      return;
    }
    setErr(null);
    setTxError(null);
    setBusy("bid");
    try {
      const ctx = await withProgram();
      const { conn, program } = ctx;
      await ensurePrivate(ctx);
      const tx = await buildPlaceBid(program, s, { game: game.pubkey, playerHand: hand, quantity: qty, face });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Place bid");
      setActedTurn(Number(g?.currentTurn));
      // Don't wait on the 2s poll — pull fresh state now so the turn moves off
      // us promptly and the button stops reading "Bid placed".
      pullSoon();
    } catch (e) {
      setTxError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  const challenge = async () => {
    if (!s) return;
    setTxError(null);
    setBusy("challenge");
    try {
      const { conn, program } = await withProgram();
      const tx = await buildChallenge(program, s, { game: game.pubkey });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Challenge");
      setActedTurn(Number(g?.currentTurn));
      pullSoon();
    } catch (e) {
      setTxError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  const forceTimeout = async () => {
    if (!s || !g) return;
    const target = (g.players as PublicKey[])[Number(g.currentTurn)];
    if (!target) return;
    setBusy("timeout");
    setTxError(null);
    try {
      const { conn, program } = await withProgram();
      const tx = await buildForceTimeout(program, s, { game: game.pubkey, target });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Force timeout");
    } catch (e) {
      setTxError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  const reveal = async () => {
    if (!wallet || !publicKey || !s) return;
    setBusy("reveal");
    try {
      const { conn, program } = await withProgram();
      const tx = await buildReveal(program, s, { game: game.pubkey, playerHand: handPda(game.pubkey, publicKey) });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Reveal dice", { quiet: true });
    } catch (e) {
      // Auto-triggered: if the round already advanced or we already revealed, that's fine.
      if (!isBenignRace(e)) setTxError(explain(e));
    } finally {
      setBusy(null);
    }
  };

  const settle = async () => {
    if (!s) return;
    setBusy("settle");
    setTxError(null);
    const result = makeRoundResult();
    try {
      const { conn, program } = await withProgram();
      const tx = await buildSettleRound(program, s, { game: game.pubkey });
      await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Settle round", { quiet: true });
      if (result) setRoundResult(result);
      await handState.refresh();
      // If settle_round just knocked us out, reclaim our hand-permission rent now —
      // our hand won't be touched again until end_game undelegates it, at which
      // point the permission becomes unreachable.
      if (wallet) {
        const fresh = await program.account.game.fetch(game.pubkey);
        const myIdx = (fresh.players as PublicKey[]).findIndex((p) => p.equals(wallet.publicKey));
        if (myIdx >= 0 && !(fresh.isActive as boolean[])[myIdx]) {
          await closeHandPermission(
            conn,
            program,
            { session: ready.session, authority: wallet.publicKey, sessionToken: ready.sessionToken },
            hand
          ).catch(() => {}); // best-effort cleanup — never block the UI on it
        }
      }
    } catch (e) {
      // Another client (or seat) settled first — the desired state was reached, so
      // don't surface a NotSettled/BadGameState error or retry.
      if (isBenignRace(e)) return;
      setTxError(explain(e));
      settleRound.current = null;
    } finally {
      setBusy(null);
    }
  };

  const payout = async () => {
    if (!s || !g) return;
    const winnerIdx = (g.isActive as boolean[]).findIndex(Boolean);
    const winner: PublicKey | undefined = winnerIdx >= 0 ? g.players[winnerIdx] : undefined;
    if (!winner) return;
    setBusy("payout");
    setTxError(null);
    // Payout moves via a separate L1 Magic Action tx; the ER tx confirms fast and is proof enough.
    const toastId = pushToast({ kind: "pending", label: "Claim prize", detail: "Committing game to base layer…" });
    try {
      const { conn, program } = await withProgram();
      // Reclaim our own hand-permission rent before end_game undelegates the hand —
      // after that this permission is unreachable. Only closes the caller's own
      // (the winner's) permission; other seats close theirs on elimination in `settle`.
      if (wallet?.publicKey.equals(winner)) {
        await closeHandPermission(
          conn,
          program,
          { session: ready.session, authority: wallet.publicKey, sessionToken: ready.sessionToken },
          hand
        ).catch(() => {}); // best-effort — never block claiming the prize on this
      }
      const hands = (g.players as PublicKey[]).map((p) => handPda(game.pubkey, p));
      const tx = await buildEndGameSession(program, s, {
        game: game.pubkey,
        vault: vaultPda(game.pubkey),
        winner,
        handAccounts: hands,
      });
      const erFqdn = conn.rpcEndpoint.split("?")[0];
      const erSig = await sendSessionTx(conn, tx.sessionSigner, tx.tx, "Pay out winner", { quiet: true });
      setPaid(true);
      pushToast(
        { kind: "success", label: "Prize claimed", detail: "Pot transferred", sig: erSig, erFqdn },
        toastId,
      );
    } catch (e) {
      const msg = explain(e);
      // ReadonlyDataModified = end_game touched accounts already committed back to
      // base — i.e. the prize was ALREADY claimed. Not an error for the player.
      if (/already committed back|ReadonlyDataModified/i.test(msg)) {
        setPaid(true);
        pushToast({ kind: "success", label: "Prize claimed", detail: "The pot was already paid out on Solana." }, toastId);
      } else {
        pushToast({ kind: "error", label: "Claim prize", detail: msg }, toastId);
        setTxError(msg);
      }
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    handState.refresh(round);
  }, [round, phase]);

  // Keep the bid inputs inside the legal window: quantity can never exceed the
  // dice still on the table (program error 6004) or fall below the minimum raise,
  // and the face auto-bumps past the previous bid when quantities are equal.
  useEffect(() => {
    if (phase !== "bidding") return;
    const minQ = previousBid ? (previousBid.face >= 6 ? previousBid.quantity + 1 : previousBid.quantity) : 1;
    const maxQ = Math.max(1, totalDice);
    setQty((q) => Math.min(Math.max(q, minQ), maxQ));
  }, [phase, previousBid, totalDice]);
  useEffect(() => {
    if (phase !== "bidding" || !previousBid) return;
    if (qty === previousBid.quantity && face <= previousBid.face) {
      setFace(Math.min(previousBid.face + 1, 6));
    }
  }, [phase, previousBid, qty, face]);

  // Clear the optimistic action lock once the on-chain turn has moved off us.
  useEffect(() => {
    if (actedTurn !== null && g != null && Number(g.currentTurn) !== actedTurn) setActedTurn(null);
  }, [g, actedTurn]);

  // Safety valve: release the "Bid placed" lock after a few seconds in case the tx never lands.
  useEffect(() => {
    if (actedTurn === null) return;
    const t = setTimeout(() => setActedTurn(null), 7000);
    return () => clearTimeout(t);
  }, [actedTurn]);

  // While a challenge is fully revealed, stash the showdown result. When the round
  // then advances (settle_round bumps `round` and clears the reveals), commit it to
  // history exactly once. Chain-derived, so all clients log identical history.
  useEffect(() => {
    if (phase === "revealing" && allRevealed) {
      const r = makeRoundResult();
      if (r) pendingShowdown.current = r;
    }
    const snap = pendingShowdown.current;
    if (snap && round > snap.round && loggedRound.current !== snap.round) {
      loggedRound.current = snap.round;
      setHistory((prev) => [snap, ...prev].slice(0, 12));
      setRoundResult(snap);
      pendingShowdown.current = null;
      // Toast here, not on settle itself — only one seat's settle tx wins the race.
      const winnerIdx = snap.bidHeld ? snap.bid.bidder : snap.challenger;
      pushToast({
        kind: "success",
        label: `Round ${snap.round} settled`,
        detail: `${playerName(winnerIdx, players, wallet!.publicKey)} won — ${playerName(snap.loser, players, wallet!.publicKey)} lost a die (${snap.actual} shown)`,
      });
    }
  }, [g, phase, allRevealed, round]);

  // Drive into bidding once we've rolled, or once the roll deadline passes even if we haven't
  // (so no-shows get struck from live chain state instead of waiting on another client).
  useEffect(() => {
    if (phase !== "rolling" || (!rolledThisRound && !deadlinePassed)) return;
    autoBegin();
    const id = setInterval(autoBegin, 2500);
    return () => clearInterval(id);
  }, [phase, rolledThisRound, deadlinePassed, round]);

  useEffect(() => {
    if (phase !== "revealing" || revealRound.current === round || handState.revealed) return;
    revealRound.current = round;
    reveal();
  }, [phase, round, handState.revealed]);

  useEffect(() => {
    if (!canSettle || settleRound.current === round) return;
    settleRound.current = round;
    // Hold on the showdown for a few seconds so every player actually sees the
    // revealed dice before settle_round advances to the next round.
    const t = setTimeout(() => settle(), 6000);
    return () => clearTimeout(t);
  }, [canSettle, round]);

  const phaseLabel = status === "ended" ? "ended" : phase;
  const urgent = countdown.left !== null && countdown.left > 0 && countdown.left <= 10;
  return (
    <>
      {walletStatus === "disconnected" && (
        <div className="tx-error">Wallet disconnected — reconnect to keep playing.</div>
      )}
      <section className="table-console">
        <div className="console-ident">
          <span className="console-code mono copyable" onClick={() => copyAddress(game.pubkey)}>{short(game.pubkey)}</span>
          <span className="console-pot">{sol(game.potLamports.toNumber())} SOL</span>
        </div>
        <div className="console-stats">
          <div className="hud-cell"><span className="hud-k">Round</span><strong>{round}</strong></div>
          <div className="hud-cell"><span className="hud-k">Phase</span><strong className={`ph-${phaseLabel}`}>{phaseLabel}</strong></div>
          <div className="hud-cell"><span className="hud-k">Bid</span><BidBadge bid={previousBid} /></div>
          <div className={`hud-cell hud-timer${urgent ? " urgent" : ""}`}>
            <span className="hud-k">Timer</span>
            <strong>{countdown.label}</strong>
          </div>
        </div>
      </section>

      <section className="table-layout">
        <div className="player-rail">
          <div className="crew-row">
            {players.map((p, i) => {
              const isMe = p.equals(wallet!.publicKey);
              const isTurn = Number(g?.currentTurn) === i && status !== "ended";
              return (
                <button
                  type="button"
                  key={p.toBase58()}
                  className={`crew-chip${isMe ? " me" : ""}${isTurn ? " turn" : ""}${active[i] ? "" : " out"}${openSeat === i ? " open" : ""}`}
                  onClick={() => setOpenSeat(openSeat === i ? null : i)}
                  title={p.toBase58()}
                >
                  <span className="crew-avatar" style={avatarPos(i)}>
                    <span className={`crew-dice${active[i] ? "" : " gone"}`}>{diceCounts[i] ?? 0}</span>
                  </span>
                  <span className="crew-name">{isMe ? "you" : short(p)}</span>
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
                            ? isMe && rolledThisRound ? "rolled" : "rolling"
                            : participating[i] ? "in round" : ""}
                  </span>
                </button>
              );
            })}
            <div className="crew-chip total-chip" aria-label={`${totalDice} total dice`}>
              <span className="crew-avatar total">🎲</span>
              <span className="crew-name">{totalDice} dice</span>
              <span className="crew-status">on table</span>
            </div>
          </div>
          {openSeat !== null && players[openSeat] && (
            <button
              type="button"
              className="crew-pub mono"
              onClick={() => {
                navigator.clipboard?.writeText(players[openSeat].toBase58());
                pushToast({ kind: "success", label: "Address copied" });
              }}
            >
              {players[openSeat].toBase58()}
              <small>{players[openSeat].equals(wallet!.publicKey) ? "your wallet — " : ""}tap to copy</small>
            </button>
          )}
          <HistoryBoard history={history} players={players} wallet={wallet!.publicKey} />
        </div>

        <section className="table-action">
          {status === "ended" ? (
            <GameOverPanel game={g} mySeat={mySeat} busy={busy} paid={paid} onPayout={payout} onExit={onExit} />
          ) : phase === "rolling" ? (
            <RollingPanel
              rolled={rolledThisRound}
              dice={handState.dice}
              diceReady={Boolean(handState.dice?.length)}
              busy={busy}
              roundResult={roundResult}
              players={players}
              me={wallet!.publicKey}
              deadlinePassed={deadlinePassed}
              myStrikes={mySeat >= 0 ? missedRolls[mySeat] ?? 0 : 0}
              onRoll={roll}
              onForceOpen={forceOpen}
            />
          ) : phase === "bidding" ? (
            <BiddingPanel
              myTurn={Boolean(myTurn)}
              turn={Number(g?.currentTurn ?? 0)}
              previousBid={previousBid}
              busy={busy}
              locked={actionLocked}
              qty={qty}
              face={face}
              setQty={setQty}
              setFace={setFace}
              onBid={bid}
              onChallenge={challenge}
              myDice={handState.dice}
              totalDice={totalDice}
              deadlinePassed={deadlinePassed}
              players={players}
              me={wallet!.publicKey}
              onForceTimeout={forceTimeout}
            />
          ) : phase === "revealing" ? (
            <RevealPanel
              reveals={g?.lastReveal ?? []}
              count={participatingCount}
              bid={previousBid}
              challenger={Number(g?.challenger ?? 0)}
              canSettle={canSettle}
              revealed={handState.revealed}
              busy={busy}
              players={players}
              me={wallet!.publicKey}
            />
          ) : null}
          {err && <div className="muted">{err}</div>}
          {txError && <div className="tx-error">{txError}</div>}
        </section>
      </section>
    </>
  );
}

function BidInputs({
  qty,
  face,
  setQty,
  setFace,
  minQty,
  maxQty,
  faceAllowed,
  previousBid,
}: {
  qty: number;
  face: number;
  setQty: (n: number) => void;
  setFace: (n: number) => void;
  minQty: number;
  maxQty: number;
  faceAllowed: (f: number) => boolean;
  previousBid: { quantity: number; face: number } | null;
}) {
  const clampQty = (n: number) => Math.max(minQty, Math.min(maxQty, Math.floor(n) || minQty));
  return (
    <div className="bid-inputs">
      <div className="bid-field">
        <span className="stat-lbl">Quantity</span>
        <div className="stepper">
          <button
            type="button"
            className="step-btn"
            onClick={() => setQty(clampQty(qty - 1))}
            disabled={qty <= minQty}
            aria-label="Decrease quantity"
          >
            −
          </button>
          <span className="step-val" aria-live="polite">{qty}</span>
          <button
            type="button"
            className="step-btn"
            onClick={() => setQty(clampQty(qty + 1))}
            disabled={qty >= maxQty}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
      </div>
      <div className="bid-field">
        <span className="stat-lbl">Face</span>
        <div className="face-picker">
          {[1, 2, 3, 4, 5, 6].map((f) => (
            <button
              type="button"
              key={f}
              className={`face-btn${face === f ? " selected" : ""}`}
              onClick={() => setFace(f)}
              disabled={!faceAllowed(f)}
              aria-label={`Face ${f}`}
              aria-pressed={face === f}
            >
              <Dice value={f} mini />
            </button>
          ))}
        </div>
        {previousBid && qty === previousBid.quantity && (
          <div className="muted face-hint">
            At quantity {qty} you must bid higher than face {previousBid.face} — raise the quantity to unlock lower faces.
          </div>
        )}
      </div>
    </div>
  );
}

function RollingPanel(props: {
  rolled: boolean;
  dice: number[] | null;
  diceReady: boolean;
  busy: string | null;
  deadlinePassed: boolean;
  myStrikes: number;
  roundResult: RoundResult | null;
  players: PublicKey[];
  me: PublicKey;
  onRoll: () => void;
  onForceOpen: () => void;
}) {
  if (!props.rolled) {
    return (
      <>
        {props.roundResult && <RoundResultPanel result={props.roundResult} players={props.players} me={props.me} />}
        <h3 className="section-head no-border">Roll</h3>
        <div className="muted">Your dice stay private until someone challenges.</div>
        {props.deadlinePassed && (
          <div className="tx-error">
            Roll window closed — missing this roll is strike {Math.min(props.myStrikes + 1, MISS_LIMIT)}/{MISS_LIMIT}
            {props.myStrikes + 1 >= MISS_LIMIT ? " and strikes you out of the game." : ". Roll now if you still can."}
          </div>
        )}
        <button className="btn" onClick={props.onRoll} disabled={Boolean(props.busy)}>
          {props.busy === "roll" ? "Rolling…" : "Roll Dice"}
        </button>
      </>
    );
  }

  // We've rolled. Bidding can't start until EVERY player has rolled (the program
  // gates it), so there are no bid inputs here — just our hand and a wait state.
  return (
    <>
      {props.roundResult && <RoundResultPanel result={props.roundResult} players={props.players} me={props.me} />}
      {props.diceReady ? (
        <MyHand dice={props.dice} />
      ) : (
        <div className="muted">Approve the private dice read once if your hand is not visible.</div>
      )}
      <div className="auto-status">
        <span className="spinner-dot" />
        {props.deadlinePassed ? "Roll window closed — opening bidding…" : "Rolled ✓ — waiting for other players to roll…"}
      </div>
      {props.deadlinePassed && (
        <button className="btn small ghost full" onClick={props.onForceOpen} disabled={Boolean(props.busy)}>
          {props.busy === "open" ? "Opening…" : "Skip no-shows & open bidding"}
        </button>
      )}
    </>
  );
}

function MyHand({ dice }: { dice: number[] | null }) {
  if (!dice?.length) return null;
  return (
    <div className="my-hand">
      <span className="stat-lbl">Your dice</span>
      <div className="dice-row">
        {dice.map((d, i) => <Dice key={i} value={d} delay={i * 60} />)}
      </div>
    </div>
  );
}

function BiddingPanel(props: {
  myTurn: boolean;
  turn: number;
  previousBid: { quantity: number; face: number } | null;
  busy: string | null;
  locked: boolean;
  qty: number;
  face: number;
  setQty: (n: number) => void;
  setFace: (n: number) => void;
  onBid: () => void;
  onChallenge: () => void;
  myDice: number[] | null;
  totalDice: number;
  deadlinePassed: boolean;
  players: PublicKey[];
  me: PublicKey;
  onForceTimeout: () => void;
}) {
  const disabled = Boolean(props.busy) || props.locked;
  const turnName = playerName(props.turn, props.players, props.me);
  const prev = props.previousBid;
  // Legal bid window against the live table: quantity can't exceed the dice in
  // play, and equal-quantity bids must raise the face.
  const minQty = prev ? (prev.face >= 6 ? prev.quantity + 1 : prev.quantity) : 1;
  const maxQty = Math.max(1, props.totalDice);
  const faceAllowed = (f: number) => !prev || props.qty > prev.quantity || f > prev.face;
  const raisePossible = minQty <= maxQty && (!prev || prev.quantity < maxQty || prev.face < 6);
  if (!props.myTurn) {
    return (
      <>
        <MyHand dice={props.myDice} />
        <div className="muted">Waiting for {turnName}.</div>
        {props.deadlinePassed && (
          <button className="btn small ghost full" onClick={props.onForceTimeout} disabled={Boolean(props.busy)}>
            {props.busy === "timeout" ? "Timing out…" : `Time out ${turnName}`}
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <MyHand dice={props.myDice} />
      <h3 className="section-head no-border">Your Turn</h3>
      {raisePossible ? (
        <>
          <BidInputs {...props} minQty={minQty} maxQty={maxQty} faceAllowed={faceAllowed} />
          <button className="btn" onClick={props.onBid} disabled={disabled}>
            {props.busy === "bid" ? "Bidding…" : props.locked ? "Bid placed" : "Raise"}
          </button>
        </>
      ) : (
        <div className="muted">The bid can't go any higher — challenge it!</div>
      )}
      {props.previousBid && (
        <button
          className={`btn btn-red ${raisePossible ? "small " : ""}full`}
          onClick={props.onChallenge}
          disabled={disabled}
        >
          {props.busy === "challenge" ? "Challenging…" : "Challenge"}
        </button>
      )}
    </>
  );
}

function RevealPanel({
  reveals,
  count,
  bid,
  challenger,
  canSettle,
  revealed,
  busy,
  players,
  me,
}: {
  reveals: any[];
  count: number;
  bid: { quantity: number; face: number } | null;
  challenger: number;
  canSettle: boolean;
  revealed: boolean;
  busy: string | null;
  players: PublicKey[];
  me: PublicKey;
}) {
  // Reveal AND settle both run automatically over the session key (see the
  // auto-reveal / auto-settle effects in LiveGameTable), so there are no manual
  // buttons here — just a live status line reflecting what the session key is doing.
  const settleStatus =
    busy === "settle"
      ? "Settling round…"
      : canSettle
        ? "All dice in — settling shortly…"
        : busy === "reveal" || !revealed
          ? "Revealing your dice…"
          : "Waiting for players to reveal…";
  // True count of the challenged face across every revealed die — the number the
  // animated tally ticks up to, and what settle_round scores the bid against.
  const allIn = reveals.length >= count && count > 0;
  const actual = bid
    ? countFace(reveals.map((r: any) => (r.dice as number[]).slice(0, Number(r.diceCount))), bid.face)
    : 0;
  return (
    <>
      <h3 className="section-head no-border">Showdown</h3>
      {bid && <div className="muted challenged-bid">Challenged bid: <BidBadge bid={bid} /> · Challenger: {playerName(challenger, players, me)}</div>}
      <div className="muted">Reveals {reveals.length}/{count}</div>
      {bid && allIn && <FaceTally reveals={reveals} face={bid.face} target={actual} />}
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
        {settleStatus}
      </div>
    </>
  );
}

function GameOverPanel({
  game,
  mySeat,
  busy,
  paid,
  onPayout,
  onExit,
}: {
  game: any;
  mySeat: number;
  busy: string | null;
  paid: boolean;
  onPayout: () => void;
  onExit: () => void;
}) {
  const winnerIdx = (game?.isActive as boolean[] | undefined)?.findIndex(Boolean) ?? -1;
  const winner: PublicKey | undefined = winnerIdx >= 0 ? game?.players[winnerIdx] : undefined;
  const iWon = winnerIdx >= 0 && winnerIdx === mySeat;
  return (
    <>
      <h3 className="section-head no-border">Game Over</h3>
      <div className="card compact-card">
        {winner ? (iWon ? "You win! 🏆" : <>Winner: <span className="mono copyable" onClick={() => copyAddress(winner)}>{short(winner)}</span></>) : "Winner resolving…"}
      </div>
      {paid && <div className="muted">Prize claimed. The game and hands were committed back.</div>}
      {iWon ? (
        <button className="btn" onClick={onPayout} disabled={Boolean(busy) || paid}>
          {busy === "payout" ? "Paying…" : paid ? "Prize Claimed" : "Claim Prize"}
        </button>
      ) : (
        <div className="muted">
          {paid ? "The winner claimed the pot." : "Only the winner can claim the pot."}
        </div>
      )}
      <button className="btn small ghost full" onClick={onExit} disabled={Boolean(busy)}>Back to Tables</button>
    </>
  );
}

function HistoryBoard({
  history,
  players,
  wallet,
}: {
  history: RoundResult[];
  players: PublicKey[];
  wallet: PublicKey;
}) {
  if (history.length === 0) return null;
  const name = (idx: number) => {
    const p = players[idx];
    return p && p.equals(wallet) ? "you" : p ? short(p) : `#${idx}`;
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

// Animated tally of the challenged face across every revealed die.
function FaceTally({ reveals, face, target }: { reveals: any[]; face: number; target: number }) {
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

function RoundResultPanel({
  result,
  players,
  me,
}: {
  result: RoundResult;
  players: PublicKey[];
  me: PublicKey;
}) {
  const winner = result.bidHeld ? result.bid.bidder : result.challenger;
  return (
    <div className="round-result">
      <div className="stat-lbl">Round {result.round} Result</div>
      <strong>
        {playerName(winner, players, me)} won the round
      </strong>
      <div className="result-meta">
        <span>{playerName(result.loser, players, me)} lost a die</span>
        <span className="challenged-bid">
          Bid <BidBadge bid={result.bid} /> · {result.actual} shown
        </span>
      </div>
    </div>
  );
}
