/** The slice of `process` this needs, so a test can stand in for it. */
export interface SignalTarget {
  on(event: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  exit(code: number): void;
}

/**
 * Closes the server cleanly on SIGTERM or SIGINT (#452), so a background import
 * stops at its next check and removes the files it wrote instead of leaving them
 * until a later startup's sweep. A second signal while closing exits at once with
 * 130 (128 + SIGINT), so a close that hangs can still be interrupted.
 */
export function closeOnSignals(close: () => Promise<void>, target: SignalTarget = process): void {
  let closing = false;
  const onSignal = () => {
    if (closing) {
      target.exit(130);
      return;
    }
    closing = true;
    close().then(
      () => target.exit(0),
      (error: unknown) => {
        console.error("Shutdown failed:", error);
        target.exit(1);
      },
    );
  };
  target.on("SIGTERM", onSignal);
  target.on("SIGINT", onSignal);
}
