/**
 * Output writer — serializes a DiscoveryOutput to a timestamped JSON file.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { logger } from '../utils/logger.js';
import type { DiscoveryOutput } from './schema.js';
import type { OutputConfig } from '../config/schema.js';

export interface WriteResult {
  path: string;
}

/**
 * Write the discovery output JSON to disk.
 *
 * - Creates the output directory if it doesn't exist.
 * - Applies the filename_pattern from config (replaces `{timestamp}`).
 * - Pretty-prints JSON for readability.
 */
export async function writeDiscoveryOutput(
  output: DiscoveryOutput,
  config: OutputConfig,
): Promise<WriteResult> {
  const dir = resolve(config.dir);
  await mkdir(dir, { recursive: true });

  const filename = resolveFilename(config.filename_pattern);
  const filePath = join(dir, filename);

  const json = JSON.stringify(output, null, 2);
  await writeFile(filePath, json, 'utf-8');

  logger.debug({ path: filePath, bytes: json.length }, 'output written');

  return { path: filePath };
}

function resolveFilename(pattern: string): string {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');

  return pattern.replace('{timestamp}', timestamp);
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
