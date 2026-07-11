import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "data"; data: T }
  | { status: "error"; error: string; lastData?: T };

type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Pure so it's testable without rendering React. A failed fetch keeps the last
// good value visible (still an error state, just not a blank screen) instead of
// discarding data the user was already looking at.
export function nextAsyncState<T>(prev: AsyncState<T>, result: FetchResult<T>): AsyncState<T> {
  if (result.ok) return { status: "data", data: result.data };
  const lastData = prev.status === "data" ? prev.data : prev.status === "error" ? prev.lastData : undefined;
  return { status: "error", error: result.error, lastData };
}

/**
 * Generic fetch(+poll) hook that always exposes an explicit error state —
 * the gap this fixes is screens that swallow a failed fetch to `null` and
 * render an infinite "…" with no way to tell "still loading" from "broke".
 */
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  pollMs?: number,
): AsyncState<T> & { refresh: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => {
    fetcherRef
      .current()
      .then((data) => setState((prev) => nextAsyncState(prev, { ok: true, data })))
      .catch((e) => setState((prev) => nextAsyncState(prev, { ok: false, error: e instanceof Error ? e.message : String(e) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    refresh();
    if (!pollMs) return;
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  return { ...state, refresh };
}
