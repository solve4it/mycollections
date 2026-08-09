import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { appVersion } from "./vite.config.js";

export default defineConfig({
  plugins: [react()],
  // Same define as the build, from the same source, so a test that asserts the
  // footer is asserting the version users will actually see.
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
  },
});
