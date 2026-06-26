/**
 * Retry helper with linear backoff.
 */

export interface RetryOptions {
  attempts: number;
  backoffMs: number;
  onAttemptFail?: (err: unknown, attempt: number) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      opts.onAttemptFail?.(err, attempt);
      if (attempt < opts.attempts) {
        await sleep(opts.backoffMs * attempt);
      }
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run async tasks with a concurrency limit. Order of results matches input.
 */
export async function pMap<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runOne(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runOne);
  await Promise.all(workers);
  return results;
}
