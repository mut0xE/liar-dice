import { describe, it, expect } from "vitest";
import { BN } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { gamePda, handPda, vaultPda } from "../pdas";

describe("pdas", () => {
  it("derives a deterministic game PDA", () => {
    const host = Keypair.generate().publicKey;
    const a = gamePda(host, new BN(1));
    const b = gamePda(host, new BN(1));
    expect(a.equals(b)).toBe(true);
  });
  it("hand PDA depends on both game and player", () => {
    const host = Keypair.generate().publicKey;
    const game = gamePda(host, new BN(1));
    const p1 = Keypair.generate().publicKey;
    const p2 = Keypair.generate().publicKey;
    expect(handPda(game, p1).equals(handPda(game, p2))).toBe(false);
  });
  it("vault PDA is stable per game", () => {
    const host = Keypair.generate().publicKey;
    const game = gamePda(host, new BN(2));
    expect(vaultPda(game).equals(vaultPda(game))).toBe(true);
  });
});
