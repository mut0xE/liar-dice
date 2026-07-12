function customErrorCode(err: unknown): number | null {
  const ie = (err as any)?.InstructionError;
  const custom = Array.isArray(ie) ? ie[1]?.Custom : undefined;
  return typeof custom === "number" ? custom : null;
}

function describeErr(err: unknown): string {
  const custom = customErrorCode(err);
  return custom !== null
    ? `Transaction reverted (custom program error: ${custom})`
    : `Transaction reverted: ${JSON.stringify(err)}`;
}

export type ConfirmResult = { status: "confirmed" } | { status: "reverted"; error: string } | { status: "unresolved" };

export type ConfirmOpts = {
  confirm: () => Promise<{ value: { err: unknown | null } }>;
  timeoutMs?: number;
  onUnresolved?: () => void;
  pollAfterTimeout?: () => Promise<{ value: { err: unknown | null } } | null>;
  backgroundAttempts?: number;
  backgroundDelayMs?: number;
  onResolvedInBackground?: (result: { status: "confirmed" } | { status: "reverted"; error: string }) => void;
};

// Fires a tx, waits briefly, then degrades to a background poll instead of hanging forever.
export async function confirmWithFallback(opts: ConfirmOpts): Promise<ConfirmResult> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs));
  const raced = await Promise.race([opts.confirm().then((r) => ({ kind: "confirm" as const, res: r })), timeout]);

  if (raced !== "timeout") {
    const err = raced.res.value?.err;
    return err ? { status: "reverted", error: describeErr(err) } : { status: "confirmed" };
  }

  opts.onUnresolved?.();
  const attempts = opts.backgroundAttempts ?? 20;
  const delayMs = opts.backgroundDelayMs ?? 3000;
  if (attempts > 0 && opts.pollAfterTimeout) {
    void (async () => {
      for (let i = 0; i < attempts; i++) {
        await new Promise((r) => setTimeout(r, delayMs));
        try {
          const status = await opts.pollAfterTimeout!();
          if (status) {
            const result = status.value?.err
              ? { status: "reverted" as const, error: describeErr(status.value.err) }
              : { status: "confirmed" as const };
            opts.onResolvedInBackground?.(result);
            return;
          }
        } catch {
          // keep polling
        }
      }
    })();
  }
  return { status: "unresolved" };
}
