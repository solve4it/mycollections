import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

/**
 * Builds the app-wide QueryClient. `onError` receives every rejected query and mutation.
 *
 * `networkMode: "always"` is deliberate. React Query tracks connectivity from
 * the window's `online`/`offline` events, which describe the *internet* — they
 * say nothing about this app's API, which runs on the same machine and stays
 * reachable while the internet is down. Under the default "online" mode, once
 * the browser reports an offline transition every request is held: the query
 * stays `pending` with `fetchStatus: "paused"`, never fetches, never rejects,
 * and so never reaches `onError`. That silent stall is what made the
 * collections page claim the user had no collections (#228).
 *
 * This does not remove the paused state — a hidden tab still pauses a retry —
 * so callers must treat "pending" and "loaded but empty" as distinct.
 */
export function createQueryClient(onError: (error: unknown) => void): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { networkMode: "always" },
      mutations: { networkMode: "always" },
    },
  });
}
