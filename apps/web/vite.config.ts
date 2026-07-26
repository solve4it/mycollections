import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The API's dev CORS allowlist names these exact origins (#242). Without
  // strictPort a busy 5173 makes Vite silently move to 5174, and every API call
  // then fails as an opaque browser CORS error; refusing to start is clearer.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
