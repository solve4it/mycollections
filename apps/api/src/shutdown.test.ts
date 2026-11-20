import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { closeOnSignals } from "./shutdown.js";

function fakeProcess() {
  const proc = new EventEmitter() as EventEmitter & { exit: (code: number) => void };
  const exits: number[] = [];
  proc.exit = (code) => exits.push(code);
  return { proc, exits };
}

describe("closeOnSignals (#452)", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("closes once on %s, then exits 0", async (signal) => {
    const { proc, exits } = fakeProcess();
    const close = vi.fn(async () => {});
    closeOnSignals(close, proc);
    proc.emit(signal);
    await vi.waitFor(() => expect(exits).toEqual([0]));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("waits for close to finish before exiting", async () => {
    const { proc, exits } = fakeProcess();
    let finish!: () => void;
    closeOnSignals(() => new Promise<void>((resolve) => (finish = resolve)), proc);
    proc.emit("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(exits).toEqual([]);
    finish();
    await vi.waitFor(() => expect(exits).toEqual([0]));
  });

  it("a second signal while closing exits at once, so a stuck close can still be interrupted", async () => {
    const { proc, exits } = fakeProcess();
    closeOnSignals(() => new Promise<void>(() => {}), proc);
    proc.emit("SIGINT");
    proc.emit("SIGINT");
    expect(exits).toEqual([130]);
  });

  it("exits 1 when close fails, saying why", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { proc, exits } = fakeProcess();
    closeOnSignals(async () => {
      throw new Error("nope");
    }, proc);
    proc.emit("SIGTERM");
    await vi.waitFor(() => expect(exits).toEqual([1]));
    expect(logged).toHaveBeenCalledWith("Shutdown failed:", new Error("nope"));
    logged.mockRestore();
  });
});
