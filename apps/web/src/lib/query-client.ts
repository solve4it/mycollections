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
/**
 * The first key segment of every query whose data is an image's object URL
 * (#37). Images are fetched with the token as blobs and shown through
 * `URL.createObjectURL`, and an object URL holds its blob in memory until it is
 * revoked — so the URL is revoked the moment its query leaves the cache.
 */
export const MEDIA_IMAGE_KEY = "media-image";

export function createQueryClient(onError: (error: unknown) => void): QueryClient {
  const queryCache = new QueryCache({ onError });
  // React Query has no per-query "garbage collected" callback; the cache's
  // `removed` event is that moment, whether by gcTime or by `removeQueries`.
  queryCache.subscribe((event) => {
    if (event.type !== "removed" || event.query.queryKey[0] !== MEDIA_IMAGE_KEY) return;
    const url = event.query.state.data;
    if (typeof url === "string") URL.revokeObjectURL(url);
  });
  return new QueryClient({
    queryCache,
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { networkMode: "always" },
      mutations: { networkMode: "always" },
    },
  });
}
