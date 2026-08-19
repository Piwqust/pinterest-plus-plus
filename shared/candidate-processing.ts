/**
 * Runs candidate work in order until one source has fully completed. A source
 * is not considered usable merely because it fetched successfully: callers
 * can reject it after decoding or rendering and the next candidate will run.
 */
export async function firstSuccessfulCandidate<T>(
  candidates: readonly string[],
  process: (candidate: string) => Promise<T>,
  failureMessage: string,
): Promise<T> {
  for (const candidate of candidates) {
    try {
      return await process(candidate);
    } catch {
      // A CDN response can be reachable yet still be undecodable. Try the
      // next candidate instead of treating a successful fetch as success.
    }
  }
  throw new Error(failureMessage);
}

/** Keeps stateful media work (the offscreen canvas and clipboard) isolated. */
export class SequentialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
