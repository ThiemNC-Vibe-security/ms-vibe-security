#!/usr/bin/env node
/**
 * Snapshot the current ./output/ into examples/sample-runs/<date>-<slug>/
 * for thesis demo / regression reference.
 *
 * Usage:
 *   npm run snapshot                       # auto-name from report.json
 *   npm run snapshot -- <slug>             # custom slug, e.g. "vc-awg-baseline"
 *
 * What gets copied:
 *   plan.json, report.json, failures.json, summary.md
 *   tests/                                  (the generated .spec.ts files)
 *
 * What gets generated:
 *   README.md — starter template with metadata pulled from report.json
 */

import { readFile, mkdir, copyFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = join(PROJECT_ROOT, 'output');
const SAMPLE_RUNS_DIR = join(PROJECT_ROOT, 'examples', 'sample-runs');

async function main() {
  // 1. Verify there is something to snapshot
  if (!existsSync(OUTPUT_DIR)) {
    console.error(`No output/ folder found at ${OUTPUT_DIR}`);
    console.error('Run the pipeline first: npm run dev -- run -d <discovery.json> -t <tester.yml>');
    process.exit(1);
  }

  const reportPath = join(OUTPUT_DIR, 'report.json');
  let report = null;
  if (existsSync(reportPath)) {
    try {
      report = JSON.parse(await readFile(reportPath, 'utf-8'));
    } catch (err) {
      console.warn('Could not parse report.json, will skip metadata enrichment');
    }
  }

  // 2. Decide destination folder name
  const customSlug = process.argv[2];
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const slug = customSlug ?? deriveSlug(report);
  const targetDir = join(SAMPLE_RUNS_DIR, `${date}-${slug}`);

  if (existsSync(targetDir)) {
    console.error(`Target folder already exists: ${targetDir}`);
    console.error('Pass a different slug: npm run snapshot -- <slug>');
    process.exit(1);
  }

  await mkdir(targetDir, { recursive: true });

  // 3. Copy artefacts
  const candidates = ['plan.json', 'report.json', 'failures.json', 'summary.md'];
  const copied = [];
  for (const name of candidates) {
    const src = join(OUTPUT_DIR, name);
    if (existsSync(src)) {
      await copyFile(src, join(targetDir, name));
      copied.push(name);
    }
  }

  // Copy tests/ directory recursively
  const testsSrc = join(OUTPUT_DIR, 'tests');
  if (existsSync(testsSrc)) {
    const testsDst = join(targetDir, 'tests');
    await copyDir(testsSrc, testsDst);
    copied.push('tests/');
  }

  // 4. Write a starter README using report metadata
  const readme = renderReadme(slug, date, report);
  await writeFile(join(targetDir, 'README.md'), readme, 'utf-8');

  console.log(`\nSnapshot written to: ${targetDir}`);
  console.log(`Files copied: ${copied.join(', ')}`);
  console.log(`\nNext: edit README.md to add observations, then commit:`);
  console.log(`  git add ${targetDir.replace(PROJECT_ROOT + '/', '')}`);
  console.log(`  git commit -m "snapshot: ${date} ${slug}"`);
}

function deriveSlug(report) {
  if (!report?.metadata?.discovery_source) return 'run';
  // pull the discovery filename root
  const src = report.metadata.discovery_source;
  const match = /discovery_(\w+)/i.exec(src);
  if (match) return `discovery-${match[1]}`;
  // fallback: last path component
  return src.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').slice(0, 30);
}

async function copyDir(src, dst) {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src);
  for (const name of entries) {
    const s = join(src, name);
    const d = join(dst, name);
    const st = await stat(s);
    if (st.isDirectory()) {
      await copyDir(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}

function renderReadme(slug, date, report) {
  const meta = report?.metadata ?? {};
  const stats = report?.stats ?? {};
  return `# Sample run — ${date} ${slug}

## Context

- **Date:** ${date}
- **Target:** _<describe the target application>_
- **Discovery source:** \`${meta.discovery_source ?? '<unknown>'}\`
- **Tester config:** \`${meta.tester_source ?? '<unknown>'}\`
- **Model:** ${meta.model ?? '<unknown>'}
- **Duration:** ${meta.duration_seconds ?? '?'}s

## Stats

- Test cases planned: ${stats.test_cases_planned ?? '?'}
- Tests generated:    ${stats.tests_generated ?? '?'}
- Tests failed:       ${stats.tests_failed ?? '?'}
- Spec files written: ${stats.spec_files_written ?? '?'}

## Command used

\`\`\`bash
# Fill in the exact command you ran for this snapshot
npm run dev -- run \\
  --discovery <path> \\
  --tester <path>
\`\`\`

## Observations

_<add notes about what this run demonstrates: interesting findings, edge cases,
generation failures, manual fixes applied, etc.>_

## Files

- \`plan.json\` — Planner output (test cases selected)
- \`report.json\` — Full generation output with all artifacts
- \`failures.json\` — Test cases where generation failed (if any)
- \`summary.md\` — Human-readable summary
- \`tests/*.spec.ts\` — Generated Playwright spec files

## Reproduce

\`\`\`bash
cd test-generator
npm run dev -- generate \\
  --plan examples/sample-runs/${date}-${slug}/plan.json \\
  --discovery <same discovery path> \\
  --tester <same tester path>
\`\`\`
`;
}

main().catch((err) => {
  console.error('snapshot failed:', err);
  process.exit(1);
});
