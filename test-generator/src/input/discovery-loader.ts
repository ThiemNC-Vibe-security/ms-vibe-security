/**
 * Load a discovery_*.json file produced by the playwright-discovery project.
 *
 * Performs only minimal validation — we trust the producer. Type errors are
 * surfaced lazily as the pipeline reads fields.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DiscoveryFile } from '../types.js';

export async function loadDiscovery(filePath: string): Promise<DiscoveryFile> {
  const absolute = resolve(filePath);
  const raw = await readFile(absolute, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Discovery file is not valid JSON: ${absolute}\n${err}`);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('metadata' in parsed) ||
    !('pages' in parsed) ||
    !Array.isArray((parsed as DiscoveryFile).pages)
  ) {
    throw new Error(
      `Discovery file is missing required fields (metadata, pages): ${absolute}`,
    );
  }

  return parsed as DiscoveryFile;
}
