import { describe, it, expect } from "vitest";
import { validateBid } from "../bidRules";

describe("validateBid", () => {
  it("accepts any valid opening bid", () => {
    expect(validateBid(null, { quantity: 2, face: 3 }).ok).toBe(true);
  });
  it("rejects face outside 1..6", () => {
    expect(validateBid(null, { quantity: 1, face: 7 }).ok).toBe(false);
    expect(validateBid(null, { quantity: 1, face: 0 }).ok).toBe(false);
  });
  it("rejects quantity < 1", () => {
    expect(validateBid(null, { quantity: 0, face: 3 }).ok).toBe(false);
  });
  it("accepts higher quantity, same face", () => {
    expect(validateBid({ quantity: 2, face: 3 }, { quantity: 3, face: 3 }).ok).toBe(true);
  });
  it("accepts same quantity, higher face", () => {
    expect(validateBid({ quantity: 2, face: 3 }, { quantity: 2, face: 5 }).ok).toBe(true);
  });
  it("rejects same quantity, lower face", () => {
    expect(validateBid({ quantity: 2, face: 3 }, { quantity: 2, face: 2 }).ok).toBe(false);
  });
  it("rejects strictly-lower bid", () => {
    expect(validateBid({ quantity: 3, face: 4 }, { quantity: 2, face: 6 }).ok).toBe(false);
  });
});
