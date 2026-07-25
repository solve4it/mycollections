import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

/**
 * Builds the app-wide QueryClient. `onError` receives every rejected query and mutation.
 *
 * `networkMode: "always"` is deliberate. The API runs on this machine, so
 * `navigator.onLine` — which reports *internet* reachability — says nothing
 * about whether it can be reached. Under React Query's default "online" mode a
 * browser that believes it is offline pauses every request: the query stays
 * `pending` with `fetchStatus: "paused"`, never fetches, never rejects, and
 * never reaches `onError`. That silent stall is what made the collections page
 * claim the user had no collections (#228).
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
