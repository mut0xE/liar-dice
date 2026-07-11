import { describe, it, expect, vi } from "vitest";
import { confirmWithFallback } from "../confirm";

describe("confirmWithFallback", () => {
  it("resolves confirmed when confirm() resolves with no error before the timeout", async () => {
    const confirm = vi.fn().mockResolvedValue({ value: { err: null } });
    const result = await confirmWithFallback({ confirm, timeoutMs: 1000 });
    expect(result).toEqual({ status: "confirmed" });
  });

  it("resolves reverted when confirm() resolves with a program error", async () => {
    const confirm = vi.fn().mockResolvedValue({ value: { err: { InstructionError: [0, { Custom: 6018 }] } } });
    const result = await confirmWithFallback({ confirm, timeoutMs: 1000 });
    expect(result).toEqual({ status: "reverted", error: expect.stringContaining("6018") });
  });

  it("times out to unresolved and calls onUnresolved when confirm() never settles", async () => {
    const confirm = vi.fn(() => new Promise(() => {})) as any; // never resolves
    const onUnresolved = vi.fn();
    const result = await confirmWithFallback({ confirm, timeoutMs: 50, onUnresolved, backgroundAttempts: 0 });
    expect(result).toEqual({ status: "unresolved" });
    expect(onUnresolved).toHaveBeenCalledOnce();
  });

  it("resolves in the background after timing out and calls onResolvedInBackground", async () => {
    let pollCount = 0;
    const confirm = vi.fn(() => new Promise(() => {})) as any;
    const pollAfterTimeout = vi.fn(async () => {
      pollCount++;
      return pollCount < 2 ? null : { value: { err: null } };
    });
    const onResolvedInBackground = vi.fn();
    await confirmWithFallback({
      confirm,
      timeoutMs: 20,
      pollAfterTimeout,
      backgroundAttempts: 5,
      backgroundDelayMs: 10,
      onResolvedInBackground,
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(onResolvedInBackground).toHaveBeenCalledWith({ status: "confirmed" });
  });
});
