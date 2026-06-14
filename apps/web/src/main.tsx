import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n/index.js";
import { recoverFromAuthError } from "./lib/auth-recovery.js";
import { router } from "./router.js";
import "./styles/global.css";

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: recoverFromAuthError }),
  mutationCache: new MutationCache({ onError: recoverFromAuthError }),
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
