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
