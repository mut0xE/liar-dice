import { describe, it, expect, vi } from "vitest";
import { Keypair, Transaction, Connection, SystemProgram } from "@solana/web3.js";
import { sendSessionTx } from "../sendSession";
import { subscribeToasts, Toast } from "../../ui/toast";

function fakeConnection(overrides: Partial<Connection>): Connection {
  return {
    getLatestBlockhash: vi.fn().mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58() }),
    sendRawTransaction: vi.fn().mockResolvedValue("fakesig"),
    rpcEndpoint: "https://example.test/?token=secret",
    ...overrides,
  } as unknown as Connection;
}

function collectToasts(): { toasts: Toast[]; unsubscribe: () => void } {
  const toasts: Toast[] = [];
  const unsubscribe = subscribeToasts((snapshot) => {
    toasts.length = 0;
    toasts.push(...snapshot);
  });
  return { toasts, unsubscribe };
}

// A real instruction avoids web3.js's "No instructions provided" console warning.
function dummyTx(from: Keypair): Transaction {
  return new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
  );
}

describe("sendSessionTx toast behavior", () => {
  it("does not push a success toast when confirmation times out unresolved", async () => {
    vi.useFakeTimers();
    try {
      const connection = fakeConnection({
        confirmTransaction: vi.fn(() => new Promise(() => {})) as any, // never resolves
        getSignatureStatus: vi.fn().mockResolvedValue({ value: null }), // background poll never finds it either
      });
      const { toasts, unsubscribe } = collectToasts();
      const sessionSigner = Keypair.generate();
      const tx = dummyTx(sessionSigner);

      const pending = sendSessionTx(connection, sessionSigner, tx, "Test action", {});
      // confirmWithFallback's default timeout is 15s (chain/confirm.ts) — flush it.
      await vi.advanceTimersByTimeAsync(15000);
      const sig = await pending;

      expect(sig).toBe("fakesig");
      const last = toasts[toasts.length - 1];
      expect(last.kind).not.toBe("success");
      expect(last.detail).toMatch(/still confirming/i);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });

  it("pushes a success toast when confirmation resolves quickly with no error", async () => {
    const connection = fakeConnection({
      confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    });
    const { toasts, unsubscribe } = collectToasts();
    const sessionSigner = Keypair.generate();
    const tx = dummyTx(sessionSigner);

    await sendSessionTx(connection, sessionSigner, tx, "Test action", {});

    const last = toasts[toasts.length - 1];
    expect(last.kind).toBe("success");
    unsubscribe();
  });
});
