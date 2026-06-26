/**
 * End-to-end pipeline orchestration.
 *
 * Wraps the four stages (load → plan → generate → merge+write) and exposes
 * helper functions for each so the CLI can also run them individually.
 */

import { resolve } from 'node:path';
import { logger } from './utils/logger.js';
import { loadDiscovery } from './input/discovery-loader.js';
import { loadTesterRequirement } from './input/tester-loader.js';
import { loadKnowledge } from './input/knowledge-loader.js';
import { buildSummary, type SummaryIndex } from './summary/builder.js';
import { runPlanner } from './planner/planner.js';
import { runGenerator } from './generator/generator.js';
import { mergeArtifacts } from './merger/merger.js';
import { writeOutput, type WriteResult } from './output/writer.js';
import type {
  DiscoveryFile,
  DiscoverySummary,
  KnowledgeBase,
  TestArtifact,
  TestPlan,
  TesterRequirement,
} from './types.js';

export interface PipelineInputs {
  discoveryPath: string;
  testerPath: string;
  knowledgeDir: string;
  outDir: string;
  concurrency?: number;
  model?: string;
}

export interface LoadedInputs {
  discovery: DiscoveryFile;
  tester: TesterRequirement;
  knowledge: KnowledgeBase;
  summary: DiscoverySummary;
  index: SummaryIndex;
}

/** Load + summarize. Cheap, no LLM call. */
export async function loadAll(
  discoveryPath: string,
  testerPath: string,
  knowledgeDir: string,
): Promise<LoadedInputs> {
  const discovery = await loadDiscovery(discoveryPath);
  const tester = await loadTesterRequirement(testerPath);
  const knowledge = await loadKnowledge(knowledgeDir);
  const { summary, index } = buildSummary(discovery);
  return { discovery, tester, knowledge, summary, index };
}

/** Step 1 only: produce a TestPlan. */
export async function planOnly(opts: PipelineInputs): Promise<{
  plan: TestPlan;
  inputs: LoadedInputs;
}> {
  const inputs = await loadAll(opts.discoveryPath, opts.testerPath, opts.knowledgeDir);
  const plan = await runPlanner({
    summary: inputs.summary,
    tester: inputs.tester,
    knowledge: inputs.knowledge,
    discoverySource: resolve(opts.discoveryPath),
    model: opts.model,
  });
  return { plan, inputs };
}

/** Step 2 only: generate test artifacts for an existing plan. */
export async function generateOnly(
  plan: TestPlan,
  inputs: LoadedInputs,
  opts: { concurrency?: number; model?: string },
): Promise<TestArtifact[]> {
  return runGenerator({
    plan,
    index: inputs.index,
    knowledge: inputs.knowledge,
    tester: inputs.tester,
    baseUrl: inputs.discovery.metadata.base_url,
    concurrency: opts.concurrency,
    model: opts.model,
  });
}

/** Full pipeline: load → plan → generate → merge → write. */
export async function runPipeline(opts: PipelineInputs): Promise<WriteResult> {
  const t0 = Date.now();
  logger.info({ ...opts }, 'pipeline starting');

  const { plan, inputs } = await planOnly(opts);

  const artifacts = await generateOnly(plan, inputs, {
    concurrency: opts.concurrency,
    model: opts.model,
  });

  const { specs } = mergeArtifacts(artifacts);

  const result = await writeOutput({
    outDir: opts.outDir,
    plan,
    specs,
    artifacts,
    tester: inputs.tester,
    discoverySource: resolve(opts.discoveryPath),
    testerSource: resolve(opts.testerPath),
    model: plan.metadata.planner_model,
    durationSeconds: (Date.now() - t0) / 1000,
  });

  logger.info(
    {
      duration_seconds: result.output.metadata.duration_seconds,
      pages: inputs.summary.pages.length,
      generated: result.output.stats.tests_generated,
      failed: result.output.stats.tests_failed,
      spec_files: result.output.stats.spec_files_written,
    },
    'pipeline complete',
  );

  return result;
}
