// Tiny framework-free toast bus. Usable from React and from plain chain helpers
// (no context/provider needed) so every transaction can raise an alert.
export type ToastKind = "pending" | "success" | "error";

export type Toast = {
  id: number;
  kind: ToastKind;
  label: string;
  detail?: string;
  sig?: string;
};

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = [...toasts];
  listeners.forEach((l) => l(snapshot));
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  l([...toasts]);
  return () => listeners.delete(l);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

// Add or replace a toast. Returns an id; pass it back to update in place
// (e.g. flip a "pending" toast to "success"/"error" once the tx resolves).
export function pushToast(t: Omit<Toast, "id">, id?: number): number {
  const tid = id ?? nextId++;
  const existing = toasts.find((x) => x.id === tid);
  if (existing) {
    Object.assign(existing, t, { id: tid });
  } else {
    toasts = [...toasts, { ...t, id: tid }];
  }
  emit();
  // success/error auto-dismiss; pending sticks until updated.
  if (t.kind !== "pending") {
    setTimeout(() => dismissToast(tid), 7000);
  }
  return tid;
}

// Wrap an async tx send so it raises pending → success/error automatically.
// The wrapped fn should resolve to the transaction signature.
export async function withTxToast<T extends string>(
  label: string,
  run: () => Promise<T>
): Promise<T> {
  const id = pushToast({ kind: "pending", label, detail: "Sending…" });
  try {
    const sig = await run();
    pushToast({ kind: "success", label, detail: "Confirmed", sig }, id);
    return sig;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    pushToast({ kind: "error", label, detail: msg }, id);
    throw e;
  }
}
