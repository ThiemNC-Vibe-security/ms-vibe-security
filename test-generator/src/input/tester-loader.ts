/**
 * Tester Requirement loader.
 *
 * Reads a YAML file describing what the tester wants generated:
 *   - which discovery file to consume
 *   - scope filters (page types, URLs)
 *   - attack priorities
 *   - test limits
 *   - test config (browsers, parallel, credentials)
 *
 * Supports ${ENV_VAR} placeholders for credentials.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { config as loadEnv } from 'dotenv';
import { logger } from '../utils/logger.js';
import type { TesterRequirement } from '../types.js';

loadEnv();

const CredentialPairSchema = z
  .object({
    user: z.string(),
    pass: z.string(),
  })
  .nullable();

export const TesterRequirementSchema = z.object({
  target_discovery: z.string().min(1),
  scope: z
    .object({
      include_page_types: z.array(z.string()).default([]),
      exclude_pages: z.array(z.string()).default([]),
      include_urls: z.array(z.string()).default([]),
    })
    .default({}),
  priorities: z
    .object({
      high: z.array(z.string()).default([]),
      medium: z.array(z.string()).default([]),
      low: z.array(z.string()).default([]),
    })
    .default({}),
  limits: z
    .object({
      max_tests: z.number().int().positive().default(50),
      max_tests_per_page: z.number().int().positive().default(10),
    })
    .default({}),
  test_config: z
    .object({
      browsers: z.array(z.string()).default(['chromium']),
      parallel: z.number().int().positive().default(4),
      base_url: z.string().optional(),
    })
    .default({}),
  credentials: z
    .object({
      valid: CredentialPairSchema.default(null),
      invalid: CredentialPairSchema.default(null),
    })
    .default({}),
});

/**
 * Load and validate a tester requirement YAML.
 */
export async function loadTesterRequirement(filePath: string): Promise<TesterRequirement> {
  const absolute = resolve(filePath);
  const raw = await readFile(absolute, 'utf-8');

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`Tester requirement is not valid YAML: ${absolute}\n${err}`);
  }

  // Expand ${ENV_VAR} placeholders before validation
  const expanded = expandEnv(parsed);

  const result = TesterRequirementSchema.safeParse(expanded);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid tester requirement:\n${issues}`);
  }

  logger.info(
    {
      target_discovery: result.data.target_discovery,
      max_tests: result.data.limits.max_tests,
      browsers: result.data.test_config.browsers,
    },
    'tester requirement loaded',
  );

  return result.data;
}

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
