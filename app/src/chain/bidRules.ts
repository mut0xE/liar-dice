export type BidT = { quantity: number; face: number };

/// A single die counts toward `face` if it shows that face OR it's a wild 1 —
/// but 1s are NOT wild when the bid itself is on 1s. Mirrors `count_face` in the
/// on-chain `logic.rs`, so the UI's tally/history match what settle_round scores.
export function dieMatches(die: number, face: number): boolean {
  return die === face || (die === 1 && face !== 1);
}

/// Count dice matching `face` (wild-1 aware) across a set of dice arrays.
export function countFace(diceLists: number[][], face: number): number {
  let total = 0;
  for (const dice of diceLists) for (const d of dice) if (dieMatches(Number(d), face)) total += 1;
  return total;
}

export function validateBid(
  prev: BidT | null,
  next: BidT
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(next.face) || next.face < 1 || next.face > 6)
    return { ok: false, reason: "Face must be 1–6" };
  if (!Number.isInteger(next.quantity) || next.quantity < 1)
    return { ok: false, reason: "Quantity must be at least 1" };
  if (prev === null) return { ok: true };
  if (next.quantity > prev.quantity) return { ok: true };
  if (next.quantity === prev.quantity && next.face > prev.face) return { ok: true };
  return { ok: false, reason: "Bid must raise quantity or face" };
}
