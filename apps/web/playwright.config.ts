import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * The accessibility audit harness (#24).
 *
 * Everything the design epic could assert from the stylesheet alone — contrast,
 * focus-ring visibility, touch-target size, reduced motion — is already asserted
 * by the integration tests under `src/styles`. What is left needs a real browser:
 * the axe rules that read computed layout and painted color, tab order, and where
 * focus actually lands. That is why this is Playwright and not axe over jsdom,
 * which models none of those.
 *
 * Deliberately not part of `pnpm test` / `pnpm check`, which must stay runnable
 * without a browser download. `pnpm test:e2e` is the entry point, and
 * `vitest.config.ts` excludes this directory so the two runners cannot both
 * collect the same `.spec.ts` files.
 */

const API_PORT = 3111;
const WEB_PORT = 4173;

/**
 * 127.0.0.1 rather than localhost throughout. With HOST=127.0.0.1 the API binds
 * v4 only, while Node resolves `localhost` verbatim and can hand back ::1 first —
 * an intermittent ECONNREFUSED on the health check that looks like a slow start.
 * The API's dev CORS allowlist names this exact page origin (apps/api/src/app.ts).
 */
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

/**
 * A fresh token per run, shared with the worker processes through the environment
 * they inherit — `??=` so re-loading this config in a worker keeps the main
 * process's value rather than minting a second one.
 *
 * Generated rather than committed because the API prints `API token: …` to stdout
 * in development (apps/api/src/server.ts), and Playwright traces capture the
 * Authorization header, so a fixed value would be published by CI logs and
 * uploaded artifacts. `authenticatedApiHeaders` fails loudly if a worker ever
 * ends up with a different one.
 */
process.env.E2E_API_TOKEN ??= randomUUID();
export const E2E_API_TOKEN: string = process.env.E2E_API_TOKEN;

/**
 * The fixture database, in memory.
 *
 * The suite creates and deletes collections, so it must never be pointed at a
 * real database — and `resolveServerConfig` falls back to `apps/api/data/app.db`
 * whenever DB_PATH arrives empty or unset, which is the working tree's actual
 * data. `:memory:` removes the failure mode rather than guarding it: there is no
 * path to get wrong, nothing on disk to delete afterwards, and every run starts
 * from an empty database without a reset step. Same choice, for the same reason,
 * as `src/lib/api-client.integration.test.ts`.
 */
const E2E_DB_PATH = ":memory:";

export default defineConfig({
  testDir: "./e2e",
  // One database behind two servers, and specs assert states that are global to
  // it — "no collections yet" is true or false for the whole API, not per spec.
  // Parallel workers would make those assertions race. The suite is small.
  workers: 1,
  fullyParallel: false,
  // An accessibility violation is not intermittent, and a retry would hide the
  // one thing worth knowing about a flaky harness.
  retries: 0,
  forbidOnly: !!process.env.CI,
  // The HTML report is what the CI job uploads on failure; `github` puts the
  // same failures inline on the pull request diff.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    /**
     * Seeded here rather than by an init script: this is applied to the context
     * before the first document, and `src/lib/token.ts` reads the key on every
     * `getToken()` without caching, so the routes' `beforeLoad` guards find it.
     * Without it every route redirects to /setup and each scan silently audits
     * the setup screen instead of the route named in the test.
     */
    storageState: {
      cookies: [],
      origins: [{ origin: WEB_URL, localStorage: [{ name: "api_token", value: E2E_API_TOKEN }] }],
    },
    /**
     * The `.screen` entrance fades opacity 0 → 1 for 150ms on every navigation,
     * which leaves axe's color-contrast rule unable to decide and fills the
     * `incomplete` bucket at random. `prefers-reduced-motion` collapses it to
     * 0.01ms (global.css), so the scan sees settled pixels.
     *
     * The consequence is that the animated path is never scanned. That is the
     * right trade: the animation is asserted separately by
     * `src/styles/motion.integration.test.ts`, and its end state is what a user
     * reads the page in.
     */
    reducedMotion: "reduce",
  },
  /**
   * Two viewports, two color schemes, because half the UI is invisible to the
   * other combination: `.shell-sidebar` is `display: none` below 768px and
   * `.shell-bottom-nav` is `display: none` above it (global.css), and the dark
   * palette only applies under `prefers-color-scheme: dark`. A single default
   * project would scan neither the mobile nav nor any dark-theme color pair.
   */
  projects: [
    { name: "desktop-light", use: { ...devices["Desktop Chrome"], colorScheme: "light" } },
    {
      name: "mobile-dark",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, colorScheme: "dark" },
    },
  ],
  webServer: [
    {
      // tsx on the source rather than the built entrypoint: nothing to go stale,
      // and no watcher. The workspace packages it imports are built by the
      // `test:e2e` turbo task's `^build`.
      command: "pnpm --filter @mycollections/api exec tsx src/server.ts",
      cwd: "../..",
      url: `${API_URL}/api/health`,
      // Every variable the server reads is pinned, none inherited. An exported
      // HOST=0.0.0.0 would otherwise bind the fixture API to every interface
      // with Host-header pinning disabled (apps/api/src/config.ts), and an
      // exported NODE_ENV=production would switch CORS from the dev origin
      // allowlist to `false` and fail every request as an opaque browser error.
      env: {
        DB_PATH: E2E_DB_PATH,
        API_TOKEN: E2E_API_TOKEN,
        PORT: String(API_PORT),
        HOST: "127.0.0.1",
        NODE_ENV: "development",
        LOG_LEVEL: "silent",
      },
      // Never attach to something already on this port: it would be a server
      // this config did not configure, backed by a database it did not choose,
      // and the fixtures would create and delete collections in it.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // Built and previewed, so the audit runs against the bundle that ships.
      // The build happens here, with VITE_API_URL set, rather than being taken
      // from a turbo cache entry produced without it — a restored `dist` would
      // fall back to the port-3001 default in `src/lib/api-client.ts`, which is
      // where a developer's real dev API lives.
      command: "pnpm run build:e2e && pnpm run preview:e2e",
      url: WEB_URL,
      env: { VITE_API_URL: API_URL },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
