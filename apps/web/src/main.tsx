import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n/index.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { recoverFromAuthError } from "./lib/auth-recovery.js";
import { registerGlobalErrorHandlers, reportQueryError } from "./lib/error-reporter.js";
import { createQueryClient } from "./lib/query-client.js";
import { router } from "./router.js";
import "./styles/global.css";

registerGlobalErrorHandlers();

function handleCacheError(error: unknown) {
  recoverFromAuthError(error);
  reportQueryError(error);
}

const queryClient = createQueryClient(handleCacheError);

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <RouterProvider router={router} />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
