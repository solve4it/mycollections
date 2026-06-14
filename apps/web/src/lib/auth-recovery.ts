import { router } from "../router.js";
import { clearToken, UnauthorizedError } from "./api-client.js";

/**
 * Global handler for query/mutation failures. A 401 means the stored API token
 * is missing or stale (e.g. the server restarted and generated a new one), so
 * we drop it and send the user back to the setup screen to enter a fresh token.
 */
export function recoverFromAuthError(error: unknown): void {
  if (!(error instanceof UnauthorizedError)) return;
  clearToken();
  void router.navigate({ to: "/setup" });
}
