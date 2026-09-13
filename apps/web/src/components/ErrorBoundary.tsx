import type { ErrorReporter } from "@mycollections/core";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { errorReporter } from "../lib/error-reporter.js";
import { AppErrorScreen } from "./ErrorScreen.js";

interface ErrorBoundaryProps {
  children: ReactNode;
  reporter?: ErrorReporter;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort boundary for errors outside the router — route render errors are
 * caught by the router's own per-route boundary first (see `defaultErrorComponent`
 * in router.ts), and a throw in the root route by the root's `errorComponent`.
 * What is left for this one is a throw from the providers above the router, or
 * from the router itself.
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
    if (this.state.hasError) return <AppErrorScreen />;
    return this.props.children;
  }
}
