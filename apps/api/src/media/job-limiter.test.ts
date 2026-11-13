import { describe, expect, it } from "vitest";
import { createJobLimiter, QueueFullError } from "./job-limiter.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createJobLimiter", () => {
  it("runs no more than `concurrency` jobs at once, starting the next as one finishes", async () => {
    const limiter = createJobLimiter({ concurrency: 1, maxWaiting: 2 });
    const first = deferred();
    const started: string[] = [];
    const a = limiter.run(async () => {
      started.push("a");
      await first.promise;
      return "a";
    });
    const b = limiter.run(async () => {
      started.push("b");
      return "b";
    });
    await Promise.resolve();
    expect(started).toEqual(["a"]);
    first.resolve();
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(started).toEqual(["a", "b"]);
  });

  it("refuses a job outright once the queue is full, rather than letting work pile up", async () => {
    const limiter = createJobLimiter({ concurrency: 1, maxWaiting: 1 });
    const gate = deferred();
    const running = limiter.run(() => gate.promise);
    const waiting = limiter.run(async () => "waited");
    await expect(limiter.run(async () => "refused")).rejects.toBeInstanceOf(QueueFullError);
    gate.resolve();
    await running;
    expect(await waiting).toBe("waited");
    // Room again once it drained.
    expect(await limiter.run(async () => "again")).toBe("again");
  });

  it("frees its slot when a job fails, and passes the failure through", async () => {
    const limiter = createJobLimiter({ concurrency: 1, maxWaiting: 0 });
    await expect(limiter.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await limiter.run(async () => "next")).toBe("next");
  });
});
