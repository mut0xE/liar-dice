import { describe, it, expect, beforeEach, vi } from "vitest";
import { getOrCreateSessionKey } from "../session";
beforeEach(() => {
    const store = {};
    vi.stubGlobal("localStorage", {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
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
