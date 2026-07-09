import { describe, it, expect, beforeEach, vi } from "vitest";
import { getOrCreateSessionKey } from "../session";

beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
});

describe("getOrCreateSessionKey", () => {
  it("returns a stable key per game", () => {
    const a = getOrCreateSessionKey("game1");
    const b = getOrCreateSessionKey("game1");
    expect(a.publicKey.equals(b.publicKey)).toBe(true);
  });
  it("returns different keys for different games", () => {
    const a = getOrCreateSessionKey("game1");
    const b = getOrCreateSessionKey("game2");
    expect(a.publicKey.equals(b.publicKey)).toBe(false);
  });
});
