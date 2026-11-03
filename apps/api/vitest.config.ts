import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests live in src only. Vitest 5 stopped excluding dist/ by default, and a
    // stale compiled copy of a test there ran the old build against current
    // assets (#396) — so collect from src rather than exclude what is not.
    include: ["src/**/*.test.ts"],
  },
});
