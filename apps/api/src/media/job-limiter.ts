/** Answered as 503: the server is busy with other images, not broken. Fixed text, sent to the client. */
export class QueueFullError extends Error {
  constructor() {
    super("Too many images are being processed; try again shortly");
    this.name = "QueueFullError";
  }
}

export interface JobLimiter {
  run<T>(job: () => Promise<T>): Promise<T>;
}

/**
 * Runs at most `concurrency` jobs at once, holds at most `maxWaiting` more, and
 * refuses the rest at once with `QueueFullError`.
 *
 * Bespoke rather than `p-limit` because refusing is the point: decoding an
 * image takes hundreds of megabytes, and a queue that only ever grows turns a
 * burst of uploads into an out-of-memory crash instead of a few 503s.
 */
export function createJobLimiter({ concurrency, maxWaiting }: { concurrency: number; maxWaiting: number }): JobLimiter {
  let running = 0;
  const waiting: (() => void)[] = [];

  return {
    async run<T>(job: () => Promise<T>): Promise<T> {
      if (running >= concurrency) {
        if (waiting.length >= maxWaiting) throw new QueueFullError();
        // A finishing job hands its slot straight to this one (see `finally`),
        // so `running` stays at the cap and nothing can slip in between.
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        running += 1;
      }
      try {
        return await job();
      } finally {
        if (waiting.length > 0) waiting.shift()?.();
        else running -= 1;
      }
    },
  };
}
