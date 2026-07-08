import type { ErrorReporter } from "@mycollections/core";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { errorReporter } from "../lib/error-reporter.js";

interface ErrorBoundaryProps {
  children: ReactNode;
  reporter?: ErrorReporter;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort boundary for errors outside the router (route render errors are
 * caught by TanStack Router first — see defaultOnCatch in router.ts).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    (this.props.reporter ?? errorReporter).capture(error, {
      source: "error-boundary",
      componentStack: info.componentStack ?? undefined,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) return <ErrorFallback />;
    return this.props.children;
  }
}

function ErrorFallback() {
  const { t } = useTranslation("common");
  return (
    <div role="alert">
      <h1>{t("error_title")}</h1>
      <p>{t("error_message")}</p>
      <button type="button" className="touch-target" onClick={() => window.location.reload()}>
        {t("error_reload")}
      </button>
    </div>
  );
}
