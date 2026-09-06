import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import { appVersion } from "./vite.config.js";

export default defineConfig({
  plugins: [react()],
  // Same define as the build, from the same source, so a test that asserts the
  // footer is asserting the version users will actually see.
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  test: {
    // Playwright's default testMatch and vitest's default include are the same
    // pattern, so without this both runners collect `e2e/*.spec.ts` — and vitest
    // then imports @playwright/test into jsdom and dies. `pnpm test` must stay
    // browser-free; `pnpm test:e2e` owns this directory.
    exclude: [...configDefaults.exclude, "e2e/**"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
  },
});
