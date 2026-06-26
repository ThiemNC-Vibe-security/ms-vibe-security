import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { config as loadEnv } from 'dotenv';
import { ConfigSchema, type Config } from './schema.js';
import { logger } from '../utils/logger.js';

loadEnv();

/**
 * Expand ${ENV_VAR} placeholders in a string.
 */
function expandEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name) => {
      const env = process.env[name];
      if (env === undefined) {
        logger.warn({ envVar: name }, 'environment variable not set, leaving placeholder empty');
        return '';
      }
      return env;
    });
  }
  if (Array.isArray(value)) {
    return value.map(expandEnv);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = expandEnv(v);
    }
    return out;
  }
  return value;
}

/**
 * Load config from a YAML file. Optionally merge CLI overrides on top.
 */
export async function loadConfig(
  configPath: string | undefined,
  cliOverrides: Partial<Config> & { target?: string } = {},
): Promise<Config> {
  let raw: Record<string, unknown> = {};

  if (configPath) {
    const absolutePath = resolve(configPath);
    logger.debug({ path: absolutePath }, 'loading config from file');
    const content = await readFile(absolutePath, 'utf-8');
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === 'object') {
      raw = parsed as Record<string, unknown>;
    }
  }

  // Expand env vars in YAML values
  raw = expandEnv(raw) as Record<string, unknown>;

  // Deep merge CLI overrides on top (CLI wins)
  const merged = deepMerge(raw, cliOverrides as Record<string, unknown>);

  // Validate
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid config:\n${issues}`);
  }

  return result.data;
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const existing = out[key];
    if (
      existing &&
      value &&
      typeof existing === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(existing) &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}
