/**
 * Output writer.
 *
 * Final step of the pipeline. Takes the plan, the merged spec files, and the
 * raw artifacts and writes everything to disk under `outDir`:
 *
 *   outDir/
 *   ├── plan.json              — the TestPlan (for re-runnable generate step)
 *   ├── report.json            — full GenerationOutput (machine-readable)
 *   ├── summary.md             — human-readable run summary
 *   ├── failures.json          — artifacts that failed generation (skipped if none)
 *   └── tests/
 *       └── <page>.spec.ts     — one per MergedSpec, ready for `npx playwright test`
 *
 * Writes are deterministic: the same inputs produce identical files (timestamps
 * aside) so this step plays nicely with CI caching and diffing.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { logger } from '../utils/logger.js';
import type { MergedSpec } from '../merger/merger.js';
import type {
  GenerationOutput,
  TestArtifact,
  TestPlan,
  TesterRequirement,
} from '../types.js';

export interface WriteOutputOptions {
  outDir: string;
  plan: TestPlan;
  specs: MergedSpec[];
  artifacts: TestArtifact[];
  tester: TesterRequirement;
  discoverySource: string;
  testerSource: string;
  model: string;
  durationSeconds: number;
}

export interface WrittenPaths {
  plan: string;
  report: string;
  summary: string;
  failures: string | null;
  tests: string[];
}

export interface WriteResult {
  output: GenerationOutput;
  paths: WrittenPaths;
}

export async function writeOutput(opts: WriteOutputOptions): Promise<WriteResult> {
  const outDir = resolve(opts.outDir);
  const testsDir = join(outDir, 'tests');

  await mkdir(testsDir, { recursive: true });

  // 1. Write spec files
  const testPaths: string[] = [];
  for (const spec of opts.specs) {
    const filePath = join(testsDir, spec.filename);
    await writeFile(filePath, spec.code, 'utf-8');
    testPaths.push(filePath);
  }

  // 2. Build the canonical GenerationOutput object
  const generated = opts.artifacts.filter((a) => a.generated_ok).length;
  const failed = opts.artifacts.length - generated;

  const output: GenerationOutput = {
    metadata: {
      discovery_source: opts.discoverySource,
      tester_source: opts.testerSource,
      generated_at: new Date().toISOString(),
      duration_seconds: Number(opts.durationSeconds.toFixed(2)),
      model: opts.model,
    },
    stats: {
      test_cases_planned: opts.plan.test_cases.length,
      tests_generated: generated,
      tests_failed: failed,
      spec_files_written: opts.specs.length,
    },
    plan: opts.plan,
    artifacts: opts.artifacts,
  };

  // 3. Write plan.json (separately so `generate` subcommand can re-consume it)
  const planPath = join(outDir, 'plan.json');
  await writeFile(planPath, JSON.stringify(opts.plan, null, 2), 'utf-8');

  // 4. Write full report (machine-readable)
  const reportPath = join(outDir, 'report.json');
  await writeFile(reportPath, JSON.stringify(output, null, 2), 'utf-8');

  // 5. Write human-readable summary
  const summaryPath = join(outDir, 'summary.md');
  await writeFile(summaryPath, renderSummary(output, opts, testPaths), 'utf-8');

  // 6. Write failures.json only if there are any
  const failedArtifacts = opts.artifacts.filter((a) => !a.generated_ok);
  let failuresPath: string | null = null;
  if (failedArtifacts.length > 0) {
    failuresPath = join(outDir, 'failures.json');
    await writeFile(failuresPath, JSON.stringify(failedArtifacts, null, 2), 'utf-8');
  }

  logger.info(
    {
      outDir,
      spec_files: testPaths.length,
      generated,
      failed,
    },
    'output written',
  );

  return {
    output,
    paths: {
      plan: planPath,
      report: reportPath,
      summary: summaryPath,
      failures: failuresPath,
      tests: testPaths,
    },
  };
}

/* --------------------------- Summary report --------------------------- */

function renderSummary(
  output: GenerationOutput,
  opts: WriteOutputOptions,
  testPaths: string[],
): string {
  const { metadata, stats, plan } = output;

  const byPriority = { high: 0, medium: 0, low: 0 };
  const byAttack = new Map<string, number>();
  const byPage = new Map<string, number>();
  for (const tc of plan.test_cases) {
    byPriority[tc.priority]++;
    byAttack.set(tc.attack_id, (byAttack.get(tc.attack_id) ?? 0) + 1);
    byPage.set(tc.target.page_url, (byPage.get(tc.target.page_url) ?? 0) + 1);
  }

  const lines: string[] = [];
  lines.push('# Test Generation Summary');
  lines.push('');
  lines.push(`- **Generated at:** ${metadata.generated_at}`);
  lines.push(`- **Model:** ${metadata.model}`);
  lines.push(`- **Duration:** ${metadata.duration_seconds}s`);
  lines.push(`- **Discovery source:** \`${metadata.discovery_source}\``);
  lines.push(`- **Tester source:** \`${metadata.tester_source}\``);
  lines.push('');

  lines.push('## Stats');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Test cases planned | ${stats.test_cases_planned} |`);
  lines.push(`| Tests generated    | ${stats.tests_generated} |`);
  lines.push(`| Tests failed       | ${stats.tests_failed} |`);
  lines.push(`| Spec files written | ${stats.spec_files_written} |`);
  lines.push('');

  lines.push('## By priority');
  lines.push('');
  lines.push(`- high:   ${byPriority.high}`);
  lines.push(`- medium: ${byPriority.medium}`);
  lines.push(`- low:    ${byPriority.low}`);
  lines.push('');

  if (byAttack.size > 0) {
    lines.push('## By attack');
    lines.push('');
    for (const [id, count] of [...byAttack.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${id}\`: ${count}`);
    }
    lines.push('');
  }

  if (byPage.size > 0) {
    lines.push('## By page (top 10)');
    lines.push('');
    const top = [...byPage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [url, count] of top) {
      lines.push(`- ${count} — ${url}`);
    }
    lines.push('');
  }

  if (testPaths.length > 0) {
    lines.push('## Spec files');
    lines.push('');
    for (const p of testPaths) lines.push(`- \`${p}\``);
    lines.push('');
  }

  const failed = output.artifacts.filter((a) => !a.generated_ok);
  if (failed.length > 0) {
    lines.push('## Failures');
    lines.push('');
    lines.push(`${failed.length} test case(s) failed generation. See \`failures.json\` for full details.`);
    lines.push('');
    for (const a of failed.slice(0, 10)) {
      lines.push(`- **${a.test_case_id}** (${a.attack_id}) — ${a.error ?? 'unknown error'}`);
    }
    if (failed.length > 10) {
      lines.push(`- ... and ${failed.length - 10} more`);
    }
    lines.push('');
  }

  lines.push('## Next steps');
  lines.push('');
  lines.push(`Run the generated tests with:`);
  lines.push('');
  lines.push('```bash');
  lines.push(`cd ${resolve(opts.outDir)}`);
  lines.push(`npx playwright test tests/`);
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}
