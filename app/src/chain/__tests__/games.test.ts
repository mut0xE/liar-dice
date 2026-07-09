import { describe, it, expect } from "vitest";
import { statusFromAccountData } from "../games";

describe("statusFromAccountData", () => {
  it("reads Waiting (0) at offset 48", () => {
    const data = Buffer.alloc(200);
    data[48] = 0;
    expect(statusFromAccountData(data)).toBe("Waiting");
  });
  it("reads Active (1)", () => {
    const data = Buffer.alloc(200);
    data[48] = 1;
    expect(statusFromAccountData(data)).toBe("Active");
  });
  it("reads Ended (2)", () => {
    const data = Buffer.alloc(200);
    data[48] = 2;
    expect(statusFromAccountData(data)).toBe("Ended");
  });
});
