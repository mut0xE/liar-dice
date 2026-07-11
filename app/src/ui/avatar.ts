import type { CSSProperties } from "react";

// Slice the 3×2 characters.png sheet: one comic crew face per seat.
export function avatarPos(seat: number): CSSProperties {
  const a = ((seat % 6) + 6) % 6;
  const col = a % 3;
  const row = Math.floor(a / 3);
  return { backgroundPosition: `${col * 50}% ${row * 100}%` };
}
