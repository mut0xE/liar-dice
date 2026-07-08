/**
 * Bid math for the flow test. The test can peek at BOTH hands (it holds every
 * session key), so it drives deterministic-but-varied gameplay: true raises,
 * bluffs, single vs multi-bid rounds. None of this is needed by a real UI.
 */
export type HandView = { dice: number[]; diceCount: number };
export type BidView = { quantity: number; face: number };

/** True count of `face` across the given hands. Ones are wild unless face === 1. */
export function countFace(hands: HandView[], face: number): number {
  let total = 0;
  for (const h of hands)
    for (const d of h.dice.slice(0, h.diceCount))
      if (d === face || (d === 1 && face !== 1)) total += 1;
  return total;
}

/** All bids that are actually TRUE, ascending by (quantity, face). */
export function trueBidsAscending(
  hands: HandView[],
  totalDice: number
): BidView[] {
  const bids: BidView[] = [];
  for (let q = 1; q <= totalDice; q++)
    for (let f = 1; f <= 6; f++)
      if (countFace(hands, f) >= q) bids.push({ quantity: q, face: f });
  return bids; // already ascending: q outer, f inner
}

/** A guaranteed-false bid strictly higher than `prev` (or a fresh one). */
export function bluffBid(
  hands: HandView[],
  totalDice: number,
  prev?: BidView
): BidView {
  // Pick the face with the fewest actual dice, then over-claim it.
  let bestFace = 1;
  let bestCount = Infinity;
  for (let f = 1; f <= 6; f++) {
    const c = countFace(hands, f);
    if (c < bestCount) {
      bestCount = c;
      bestFace = f;
    }
  }
  let q = bestCount + 1; // strictly more than exist -> false
  if (prev) q = Math.max(q, prev.quantity + 1); // must out-rank prev, still false
  if (q > totalDice) q = totalDice; // clamp; still >= actual for bestFace
  return { quantity: q, face: bestFace };
}
