#!/usr/bin/env node
/**
 * Test Generator CLI.
 *
 * Commands:
 *   run       Full pipeline (default)
 *   plan      Run only the planner — emit plan.json
 *   generate  Run only the generator from an existing plan.json
 *   inspect   Show a summary of a plan.json without making any LLM calls
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { logger } from './utils/logger.js';
import {
  loadAll,
  planOnly,
  generateOnly,
  runPipeline,
} from './pipeline.js';
import { mergeArtifacts } from './merger/merger.js';
import { writeOutput } from './output/writer.js';
import type { TestPlan } from './types.js';

const DEFAULT_KNOWLEDGE = './knowledge';
const DEFAULT_OUT = './output';

const program = new Command();
program
  .name('test-gen')
  .description('Plan-then-Generate Playwright security tests from a discovery JSON')
  .version('0.1.0');

/* ------------------------------ run ------------------------------ */

program
  .command('run', { isDefault: true })
  .description('Full pipeline: load → plan → generate → write')
  .requiredOption('-d, --discovery <path>', 'discovery JSON from playwright-discovery')
  .requiredOption('-t, --tester <path>', 'tester requirement YAML')
  .option('-k, --knowledge <dir>', 'knowledge directory', DEFAULT_KNOWLEDGE)
  .option('-o, --out <dir>', 'output directory', DEFAULT_OUT)
  .option('--concurrency <n>', 'generator concurrency', (v) => Number(v))
  .option('--model <name>', 'override Gemini model')
  .option('-v, --verbose', 'debug logging')
  .action(async (opts) => {
    if (opts.verbose) logger.level = 'debug';
    try {
      const result = await runPipeline({
        discoveryPath: opts.discovery,
        testerPath: opts.tester,
        knowledgeDir: opts.knowledge,
        outDir: opts.out,
        concurrency: opts.concurrency,
        model: opts.model,
      });
      console.log('');
      console.log(`Plan:    ${result.paths.plan}`);
      console.log(`Tests:   ${result.paths.tests.length} files in ${opts.out}/tests/`);
      console.log(`Report:  ${result.paths.report}`);
      console.log(`Summary: ${result.paths.summary}`);
      console.log(`Generated ${result.output.stats.tests_generated}/${result.output.stats.test_cases_planned} tests in ${result.output.metadata.duration_seconds}s`);
    } catch (err) {
      logger.error({ err: String(err) }, 'pipeline failed');
      process.exitCode = 1;
    }
  });

/* ----------------------------- plan ----------------------------- */

program
  .command('plan')
  .description('Run only the planner step → plan.json')
  .requiredOption('-d, --discovery <path>', 'discovery JSON')
  .requiredOption('-t, --tester <path>', 'tester requirement YAML')
  .option('-k, --knowledge <dir>', 'knowledge directory', DEFAULT_KNOWLEDGE)
  .option('-o, --out <path>', 'output plan file', './output/plan.json')
  .option('--model <name>', 'override Gemini model')
  .option('-v, --verbose', 'debug logging')
  .action(async (opts) => {
    if (opts.verbose) logger.level = 'debug';
    try {
      const { plan } = await planOnly({
        discoveryPath: opts.discovery,
        testerPath: opts.tester,
        knowledgeDir: opts.knowledge,
        outDir: '.',
        model: opts.model,
      });

      const outPath = resolve(opts.out);
      const { mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, JSON.stringify(plan, null, 2), 'utf-8');

      console.log(`Wrote ${outPath} (${plan.test_cases.length} test cases)`);
    } catch (err) {
      logger.error({ err: String(err) }, 'plan failed');
      process.exitCode = 1;
    }
  });

/* --------------------------- generate --------------------------- */

program
  .command('generate')
  .description('Run only the generator from an existing plan.json')
  .requiredOption('-p, --plan <path>', 'plan.json from the planner step')
  .requiredOption('-d, --discovery <path>', 'discovery JSON (same one used for the plan)')
  .requiredOption('-t, --tester <path>', 'tester requirement YAML')
  .option('-k, --knowledge <dir>', 'knowledge directory', DEFAULT_KNOWLEDGE)
  .option('-o, --out <dir>', 'output directory', DEFAULT_OUT)
  .option('--concurrency <n>', 'generator concurrency', (v) => Number(v))
  .option('--model <name>', 'override Gemini model')
  .option('-v, --verbose', 'debug logging')
  .action(async (opts) => {
    if (opts.verbose) logger.level = 'debug';
    try {
      const planRaw = await readFile(resolve(opts.plan), 'utf-8');
      const plan = JSON.parse(planRaw) as TestPlan;

      const inputs = await loadAll(opts.discovery, opts.tester, opts.knowledge);

      const t0 = Date.now();
      const artifacts = await generateOnly(plan, inputs, {
        concurrency: opts.concurrency,
        model: opts.model,
      });
      const { specs } = mergeArtifacts(artifacts);

      const result = await writeOutput({
        outDir: opts.out,
        plan,
        specs,
        artifacts,
        tester: inputs.tester,
        discoverySource: resolve(opts.discovery),
        testerSource: resolve(opts.tester),
        model: plan.metadata.planner_model,
        durationSeconds: (Date.now() - t0) / 1000,
      });

      console.log(`Tests:   ${result.paths.tests.length} files`);
      console.log(`Report:  ${result.paths.report}`);
      console.log(`Summary: ${result.paths.summary}`);
      console.log(`Generated ${result.output.stats.tests_generated}/${result.output.stats.test_cases_planned} tests`);
    } catch (err) {
      logger.error({ err: String(err) }, 'generate failed');
      process.exitCode = 1;
    }
  });

/* ---------------------------- inspect ---------------------------- */

program
  .command('inspect <plan-path>')
  .description('Show a summary of a plan.json (no LLM calls)')
  .action(async (planPath: string) => {
    const abs = resolve(planPath);
    if (!existsSync(abs)) {
      logger.error({ path: abs }, 'plan file not found');
      process.exitCode = 1;
      return;
    }
    const raw = await readFile(abs, 'utf-8');
    const plan = JSON.parse(raw) as TestPlan;

    console.log(`Plan: ${abs}`);
    console.log(`Generated: ${plan.metadata.generated_at}`);
    console.log(`Model: ${plan.metadata.planner_model}`);
    console.log(`Discovery source: ${plan.metadata.discovery_source}`);
    console.log(`Test cases: ${plan.test_cases.length}`);
    console.log('');

    const byPriority = { high: 0, medium: 0, low: 0 };
    const byAttack = new Map<string, number>();
    const byPage = new Map<string, number>();

    for (const tc of plan.test_cases) {
      byPriority[tc.priority]++;
      byAttack.set(tc.attack_id, (byAttack.get(tc.attack_id) ?? 0) + 1);
      byPage.set(tc.target.page_url, (byPage.get(tc.target.page_url) ?? 0) + 1);
    }

    console.log('By priority:');
    for (const [p, c] of Object.entries(byPriority)) console.log(`  ${p.padEnd(8)} ${c}`);
    console.log('');

    console.log('By attack:');
    for (const [a, c] of [...byAttack.entries()].sort((x, y) => y[1] - x[1])) {
      console.log(`  ${a.padEnd(25)} ${c}`);
    }
    console.log('');

    console.log('By page (top 10):');
    const topPages = [...byPage.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
    for (const [p, c] of topPages) console.log(`  ${c}  ${p}`);
  });

/* ---------------------------- helpers ---------------------------- */

await program.parseAsync(process.argv);
