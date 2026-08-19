/** Rejects a stalled browser operation while still observing its eventual outcome. */
export function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(resolve, reject).finally(() => globalThis.clearTimeout(timer));
  });
}
