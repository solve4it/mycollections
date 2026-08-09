import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The released version, stamped into the UI's cabinet footer (#222).
 *
 * Read from the release-please manifest rather than a package.json: the root
 * package is private and carries no `version` field until release-please cuts
 * the first release, whereas the manifest always holds the current one.
 */
export const appVersion: string = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../.release-please-manifest.json", import.meta.url)), "utf8"),
)["."];

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  // The API's dev CORS allowlist names these exact origins (#242). Without
  // strictPort a busy 5173 makes Vite silently move to 5174, and every API call
  // then fails as an opaque browser CORS error; refusing to start is clearer.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
