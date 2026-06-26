/**
 * Planner step.
 *
 * Inputs:  DiscoverySummary, TesterRequirement, KnowledgeBase
 * Output:  TestPlan (validated against zod)
 *
 * One LLM call. The prompt is deterministic — we get good caching from the
 * Gemini side when re-running with the same inputs.
 *
 * Post-processing:
 *   - Re-number test_case IDs to TC-001, TC-002... (LLM sometimes drifts).
 *   - Drop test cases that reference unknown page_id or attack_id.
 *   - Enforce limits.max_tests and limits.max_tests_per_page.
 */

import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { completeJson } from '../llm/gemini-client.js';
import { buildKnowledgeIndex, buildPlannerPrompt } from './prompt.js';
import type {
  DiscoverySummary,
  KnowledgeBase,
  TestCase,
  TestPlan,
  TesterRequirement,
} from '../types.js';

const TestCaseSchema = z.object({
  id: z.string(),
  target: z.object({
    page_id: z.string(),
    page_url: z.string(),
    form_id: z.string().optional(),
    input_id: z.string().optional(),
    url_parameter: z.string().optional(),
  }),
  attack_id: z.string(),
  attack_class: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  why: z.string(),
  hints: z.array(z.string()).optional(),
});

const PlannerResponseSchema = z.object({
  test_cases: z.array(TestCaseSchema),
});

export interface RunPlannerOptions {
  summary: DiscoverySummary;
  tester: TesterRequirement;
  knowledge: KnowledgeBase;
  discoverySource: string;
  model?: string;
}

export async function runPlanner(opts: RunPlannerOptions): Promise<TestPlan> {
  const { summary, tester, knowledge, discoverySource } = opts;

  const knowledgeIndex = buildKnowledgeIndex(knowledge);
  const prompt = buildPlannerPrompt(summary, tester, knowledgeIndex);

  logger.info(
    {
      pages: summary.pages.length,
      attacks_available: knowledgeIndex.length,
      max_tests: tester.limits.max_tests,
    },
    'planner starting',
  );

  const t0 = Date.now();
  const response = await completeJson(prompt, PlannerResponseSchema, {
    tag: 'planner',
    model: opts.model,
    retries: 3,
  });

  const cleaned = postProcess(response.test_cases, summary, knowledge, tester);

  const plan: TestPlan = {
    metadata: {
      discovery_source: discoverySource,
      generated_at: new Date().toISOString(),
      planner_model: opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      pages_considered: summary.pages.length,
      test_count: cleaned.length,
    },
    test_cases: cleaned,
  };

  logger.info(
    {
      duration_ms: Date.now() - t0,
      raw_test_cases: response.test_cases.length,
      kept: cleaned.length,
      dropped: response.test_cases.length - cleaned.length,
    },
    'planner complete',
  );

  return plan;
}

/**
 * Drop test cases that refer to unknown IDs, then enforce limits.
 */
function postProcess(
  raw: TestCase[],
  summary: DiscoverySummary,
  knowledge: KnowledgeBase,
  tester: TesterRequirement,
): TestCase[] {
  const knownPages = new Set(summary.pages.map((p) => p.page_id));
  const validIds: TestCase[] = [];

  for (const tc of raw) {
    if (!knownPages.has(tc.target.page_id)) {
      logger.warn({ tc_id: tc.id, page_id: tc.target.page_id }, 'dropping test case: unknown page_id');
      continue;
    }
    if (!knowledge.byId.has(tc.attack_id)) {
      logger.warn({ tc_id: tc.id, attack_id: tc.attack_id }, 'dropping test case: unknown attack_id');
      continue;
    }
    validIds.push(tc);
  }

  // Order by priority (high > medium > low), then preserve original ordering.
  const priorityRank = { high: 0, medium: 1, low: 2 } as const;
  validIds.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

  // Enforce per-page limit
  const perPageCounts = new Map<string, number>();
  const afterPerPage: TestCase[] = [];
  for (const tc of validIds) {
    const count = perPageCounts.get(tc.target.page_id) ?? 0;
    if (count >= tester.limits.max_tests_per_page) continue;
    perPageCounts.set(tc.target.page_id, count + 1);
    afterPerPage.push(tc);
  }

  // Enforce global limit
  const final = afterPerPage.slice(0, tester.limits.max_tests);

  // Renumber IDs deterministically (TC-001..)
  return final.map((tc, idx) => ({
    ...tc,
    id: `TC-${String(idx + 1).padStart(3, '0')}`,
  }));
}
