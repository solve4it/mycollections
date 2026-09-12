import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import i18n from "./i18n/index.js";
import { recoverFromAuthError } from "./lib/auth-recovery.js";
import { syncDocumentLanguage } from "./lib/document-language.js";
import { registerGlobalErrorHandlers, reportQueryError } from "./lib/error-reporter.js";
import { createQueryClient } from "./lib/query-client.js";
import { applyTheme, getThemePreference } from "./lib/theme.js";
import { router } from "./router.js";
import "./styles/global.css";

registerGlobalErrorHandlers();

// index.html already stamped the attribute before first paint; re-applying here
// keeps the app itself the source of truth (and sets the theme-color meta tags, which
// the boot script deliberately leaves alone).
applyTheme(getThemePreference());

// index.html stamped lang="en" for the same reason; from here the selected
// language owns the attribute, for as long as the document lives (#277).
syncDocumentLanguage(i18n);

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
