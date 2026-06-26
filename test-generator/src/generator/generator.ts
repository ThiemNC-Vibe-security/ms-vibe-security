/**
 * Generator step.
 *
 * For each TestCase in the plan, build a focused context and ask the LLM for
 * one Playwright test. Runs with a concurrency cap (default 5) so we don't
 * hammer the Gemini API.
 *
 * Returns one TestArtifact per TestCase. A failed generation produces an
 * artifact with `generated_ok: false` and an `error` string — the run does
 * not abort.
 */

import { logger } from '../utils/logger.js';
import { pMap } from '../utils/retry.js';
import { complete, stripFences } from '../llm/gemini-client.js';
import type { SummaryIndex } from '../summary/builder.js';
import type {
  KnowledgeBase,
  TestArtifact,
  TestCase,
  TestPlan,
  TesterRequirement,
} from '../types.js';
import { buildContext } from './context.js';
import { buildGeneratorPrompt } from './prompt.js';

export interface RunGeneratorOptions {
  plan: TestPlan;
  index: SummaryIndex;
  knowledge: KnowledgeBase;
  tester: TesterRequirement;
  baseUrl: string;
  concurrency?: number;
  model?: string;
}

export async function runGenerator(opts: RunGeneratorOptions): Promise<TestArtifact[]> {
  const concurrency =
    opts.concurrency ?? Number(process.env.GENERATOR_CONCURRENCY ?? 5);

  logger.info(
    {
      test_count: opts.plan.test_cases.length,
      concurrency,
    },
    'generator starting',
  );

  const t0 = Date.now();

  const artifacts = await pMap(
    opts.plan.test_cases,
    (tc) => generateOne(tc, opts),
    concurrency,
  );

  const ok = artifacts.filter((a) => a.generated_ok).length;
  const failed = artifacts.length - ok;
  logger.info(
    { duration_ms: Date.now() - t0, ok, failed },
    'generator complete',
  );

  return artifacts;
}

async function generateOne(
  tc: TestCase,
  opts: RunGeneratorOptions,
): Promise<TestArtifact> {
  const filename = filenameFor(tc, opts.index);
  let ctx;
  try {
    ctx = buildContext(tc, opts.index, opts.knowledge, opts.tester, opts.baseUrl);
  } catch (err) {
    return failureArtifact(tc, filename, `context build failed: ${err}`);
  }

  const prompt = buildGeneratorPrompt(ctx);

  try {
    const raw = await complete(prompt, {
      tag: `generator:${tc.id}`,
      model: opts.model,
      retries: 2,
    });
    const code = stripFences(raw).trim();

    // Minimal sanity check
    if (!code.includes("test(") || !code.includes("@playwright/test")) {
      logger.warn({ tc_id: tc.id }, 'generated code missing expected Playwright markers');
    }

    return {
      test_case_id: tc.id,
      page_id: tc.target.page_id,
      page_url: tc.target.page_url,
      attack_id: tc.attack_id,
      filename,
      code,
      generated_ok: true,
    };
  } catch (err) {
    logger.error({ tc_id: tc.id, err: String(err).slice(0, 200) }, 'generator failed for test case');
    return failureArtifact(tc, filename, String(err).slice(0, 500));
  }
}

function failureArtifact(
  tc: TestCase,
  filename: string,
  error: string,
): TestArtifact {
  return {
    test_case_id: tc.id,
    page_id: tc.target.page_id,
    page_url: tc.target.page_url,
    attack_id: tc.attack_id,
    filename,
    code: `// ${tc.id} - generation failed: ${error}`,
    generated_ok: false,
    error,
  };
}

/**
 * Derive a stable filename for the test from page URL.
 * Tests for the same page get merged into the same .spec.ts file.
 */
function filenameFor(tc: TestCase, index: SummaryIndex): string {
  const page = index.pages.get(tc.target.page_id);
  if (!page) return `${slug(tc.target.page_id)}.spec.ts`;
  const path = safePath(page.url);
  return `${path || 'home'}.spec.ts`;
}

function safePath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/+|\/+$/g, '');
    return slug(path || u.host);
  } catch {
    return slug(url);
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'page'
  );
}
