/**
 * Gemini LLM client.
 *
 * Thin wrapper around @google/generative-ai. Exposes two operations the
 * pipeline needs:
 *   - complete(prompt)               → returns raw text
 *   - completeJson(prompt, schema)   → parses + zod-validates JSON
 *
 * Both retry on transient failures (network errors, rate limits) and report
 * approximate token usage when the API surfaces it.
 */

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { z, type ZodSchema } from 'zod';
import { config as loadEnv } from 'dotenv';
import { logger } from '../utils/logger.js';
import { retry } from '../utils/retry.js';

loadEnv();

const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Add it to your .env file.');
    }
    client = new GoogleGenerativeAI(apiKey);
  }
  return client;
}

function getModel(modelName?: string): GenerativeModel {
  return getClient().getGenerativeModel({ model: modelName ?? DEFAULT_MODEL });
}

export interface CompleteOptions {
  model?: string;
  retries?: number;
  /** Tag used in logs to attribute calls (e.g. "planner", "generator:TC-001"). */
  tag?: string;
  /** When true, instruct Gemini to return JSON. */
  responseJson?: boolean;
}

/**
 * Run a completion. Returns the raw text response.
 */
export async function complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
  const tag = opts.tag ?? 'gemini';
  const model = getModel(opts.model);

  return retry(
    async () => {
      const t0 = Date.now();
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: opts.responseJson
          ? { responseMimeType: 'application/json' }
          : undefined,
      });
      const response = result.response;
      const text = response.text();

      const usage = response.usageMetadata;
      logger.debug(
        {
          tag,
          duration_ms: Date.now() - t0,
          tokens_in: usage?.promptTokenCount,
          tokens_out: usage?.candidatesTokenCount,
          chars: text.length,
        },
        'gemini call complete',
      );

      if (!text || text.trim().length === 0) {
        throw new Error('Gemini returned empty response');
      }

      return text.trim();
    },
    {
      attempts: opts.retries ?? 3,
      backoffMs: 2000,
      onAttemptFail: (err, attempt) =>
        logger.warn({ tag, attempt, err: String(err).slice(0, 200) }, 'gemini call failed - retrying'),
    },
  );
}

/**
 * Run a completion that should return JSON, parse it, validate against a zod schema.
 */
export async function completeJson<T>(
  prompt: string,
  schema: ZodSchema<T>,
  opts: CompleteOptions = {},
): Promise<T> {
  const text = await complete(prompt, { ...opts, responseJson: true });
  const cleaned = stripFences(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    logger.error({ tag: opts.tag, preview: cleaned.slice(0, 300) }, 'JSON parse failed');
    throw new Error(`Gemini returned invalid JSON: ${err}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    logger.error(
      { tag: opts.tag, preview: cleaned.slice(0, 300) },
      `Gemini JSON failed schema validation:\n${issues}`,
    );
    throw new Error(`Gemini JSON does not match expected schema:\n${issues}`);
  }

  return result.data;
}

/**
 * Strip markdown code fences that LLMs frequently wrap output in.
 */
function stripFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice('```json'.length);
  else if (s.startsWith('```typescript')) s = s.slice('```typescript'.length);
  else if (s.startsWith('```ts')) s = s.slice('```ts'.length);
  else if (s.startsWith('```')) s = s.slice(3);
  if (s.endsWith('```')) s = s.slice(0, -3);
  return s.trim();
}

/** Expose the strip helper for the generator (it cleans TS code too). */
export { stripFences };

/** Tiny utility — re-exported here so callers can build schemas alongside requests. */
export { z };
