import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Dice } from "./Dice";

// Shared between the live table (GameTable) and the read-only spectator view
// (SpectateTable) so both render identical HUD/bid/timer chrome — a spectator's
// screen should look like a player's, minus the controls.

// Mirrors `MISS_LIMIT` in the on-chain program (state.rs): a seat that misses this
// many rolling phases IN A ROW is eliminated; earlier misses are just strikes.
export const MISS_LIMIT = 2;

export const short = (k: PublicKey) => k.toBase58().slice(0, 4) + "…" + k.toBase58().slice(-4);

// A player's label for showdown/result text: "You" for the local wallet (spectators
// pass a key that never matches a seat), otherwise the player's address (shortened).
export const playerName = (idx: number, players: PublicKey[], me: PublicKey) => {
  const p = players[idx];
  if (!p) return "Player";
  return p.equals(me) ? "You" : short(p);
};

export const sol = (n: number) => (n / LAMPORTS_PER_SOL).toFixed(3);

export function enumKey(v: Record<string, unknown> | string | undefined, fallback = ""): string {
  if (!v) return fallback;
  return typeof v === "string" ? v.toLowerCase() : Object.keys(v)[0] ?? fallback;
}

export function useCountdown(deadline?: number): { label: string; left: number | null } {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  if (!deadline) return { label: "--", left: null };
  const left = Math.max(0, deadline - now);
  const m = Math.floor(left / 60);
  const s = left % 60;
  return { label: `${m}:${s.toString().padStart(2, "0")}`, left };
}

// Show a bid as "<count> ×[die]" — quantity as a number, face as a pipped die, so
// the two numbers never blur together (e.g. "3 × ⚃" instead of "3 x 4").
export function BidBadge({ bid }: { bid: { quantity: number; face: number } | null }) {
  if (!bid) return <span className="bid-badge muted">none</span>;
  return (
    <span className="bid-badge">
      <strong>{bid.quantity}</strong>
      <span className="bid-times">×</span>
      <Dice value={bid.face} mini />
    </span>
  );
}
