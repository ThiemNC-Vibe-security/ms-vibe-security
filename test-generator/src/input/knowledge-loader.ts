/**
 * Knowledge loader. Reads all *.yml files under knowledge/attacks/ and builds
 * a KnowledgeBase indexed by attack id.
 *
 * Each YAML must conform to KnowledgeAttackSchema (see below). Files that fail
 * validation are skipped with a warning rather than aborting the run.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { KnowledgeAttack, KnowledgeBase } from '../types.js';

export const KnowledgeAttackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  owasp: z.array(z.string()).default([]),
  applies_to: z.array(z.string()).min(1),
  payloads: z.array(z.string()).default([]),
  detection: z.array(z.string()).default([]),
  test_template_hints: z.array(z.string()).default([]),
  description: z.string().optional(),
});

export type LoadedAttack = z.infer<typeof KnowledgeAttackSchema>;

/**
 * Load all attack definitions from a directory.
 * Looks recursively (one level deep is enough for the current layout).
 */
export async function loadKnowledge(knowledgeDir: string): Promise<KnowledgeBase> {
  const root = resolve(knowledgeDir);
  const attacks: KnowledgeAttack[] = [];

  const attacksDir = join(root, 'attacks');
  let files: string[];
  try {
    files = await readdir(attacksDir);
  } catch {
    throw new Error(`Knowledge directory not found: ${attacksDir}`);
  }

  for (const file of files) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
    const fullPath = join(attacksDir, file);

    try {
      const raw = await readFile(fullPath, 'utf-8');
      const parsed = yaml.load(raw);
      const validated = KnowledgeAttackSchema.parse(parsed);
      attacks.push(validated);
    } catch (err) {
      logger.warn(
        { file: fullPath, err: String(err).slice(0, 200) },
        'skipped invalid knowledge file',
      );
    }
  }

  if (attacks.length === 0) {
    throw new Error(`No valid knowledge files found in ${attacksDir}`);
  }

  // Detect duplicate IDs
  const seen = new Set<string>();
  for (const a of attacks) {
    if (seen.has(a.id)) {
      throw new Error(`Duplicate attack id "${a.id}" in knowledge directory`);
    }
    seen.add(a.id);
  }

  const byId = new Map<string, KnowledgeAttack>();
  for (const a of attacks) byId.set(a.id, a);

  logger.info({ count: attacks.length, dir: attacksDir }, 'knowledge loaded');

  return { attacks, byId };
}

/**
 * Filter the knowledge base to attacks that target a given component type.
 */
export function attacksFor(component_type: string, kb: KnowledgeBase): KnowledgeAttack[] {
  return kb.attacks.filter((a) => a.applies_to.includes(component_type));
}
