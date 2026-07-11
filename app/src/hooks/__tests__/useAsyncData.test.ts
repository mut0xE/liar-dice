import { describe, it, expect } from "vitest";
import { nextAsyncState, AsyncState } from "../useAsyncData";

describe("nextAsyncState", () => {
  it("moves from loading to data on a successful result", () => {
    const prev: AsyncState<number> = { status: "loading" };
    const next = nextAsyncState(prev, { ok: true, data: 42 });
    expect(next).toEqual({ status: "data", data: 42 });
  });

  it("moves from loading to error on a failed result", () => {
    const prev: AsyncState<number> = { status: "loading" };
    const next = nextAsyncState(prev, { ok: false, error: "boom" });
    expect(next).toEqual({ status: "error", error: "boom", lastData: undefined });
  });

  it("keeps the last good data when a subsequent fetch fails", () => {
    const prev: AsyncState<number> = { status: "data", data: 7 };
    const next = nextAsyncState(prev, { ok: false, error: "network down" });
    expect(next).toEqual({ status: "error", error: "network down", lastData: 7 });
  });

  it("clears the error and returns to data on a subsequent success", () => {
    const prev: AsyncState<number> = { status: "error", error: "network down", lastData: 7 };
    const next = nextAsyncState(prev, { ok: true, data: 8 });
    expect(next).toEqual({ status: "data", data: 8 });
  });

  it("retains lastData across repeated failures", () => {
    const prev: AsyncState<number> = { status: "error", error: "first fail", lastData: 7 };
    const next = nextAsyncState(prev, { ok: false, error: "second fail" });
    expect(next).toEqual({ status: "error", error: "second fail", lastData: 7 });
  });
});
