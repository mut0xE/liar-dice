import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { findGameByAddress } from "../useGames";
import { GameSummary } from "../../chain/games";

// Minimal GameSummary stub — only the pubkey matters for the lookup helper.
function stub(): GameSummary {
  return { pubkey: Keypair.generate().publicKey } as unknown as GameSummary;
}

describe("findGameByAddress", () => {
  const games = [stub(), stub(), stub()];

  it("finds a game by its base58 address", () => {
    const target = games[1];
    expect(findGameByAddress(games, target.pubkey.toBase58())).toBe(target);
  });

  it("returns null for an unknown address", () => {
    expect(findGameByAddress(games, Keypair.generate().publicKey.toBase58())).toBeNull();
  });

  it("returns null when address is undefined", () => {
    expect(findGameByAddress(games, undefined)).toBeNull();
  });

  it("returns null against an empty list", () => {
    expect(findGameByAddress([], "anything")).toBeNull();
  });
});
