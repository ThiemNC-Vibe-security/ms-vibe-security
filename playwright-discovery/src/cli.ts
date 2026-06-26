#!/usr/bin/env node
/**
 * Playwright Discovery CLI.
 *
 * Commands:
 *   run        Run discovery against a target URL (default)
 *   init       Write a starter discovery.yml template to disk
 *   validate   Validate a discovery output JSON file against the schema
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Command } from 'commander';
import { loadConfig } from './config/loader.js';
import type { Config } from './config/schema.js';
import { buildAuth } from './auth/index.js';
import { Crawler } from './crawler/crawler.js';
import { writeDiscoveryOutput } from './output/writer.js';
import { logger } from './utils/logger.js';

const program = new Command();

program
  .name('discovery')
  .description('Playwright-based website discovery for security test generation')
  .version('0.1.0');

/* ------------------------------ run ------------------------------ */

program
  .command('run', { isDefault: true })
  .description('Run discovery against a target URL')
  .option('-c, --config <path>', 'path to config YAML file')
  .option('-u, --url <url>', 'target URL (overrides config.target)')
  .option('--max-pages <n>', 'maximum pages to crawl', (v) => Number(v))
  .option('--max-depth <n>', 'maximum crawl depth', (v) => Number(v))
  .option('--strategy <bfs|dfs>', 'crawl strategy')
  .option('--output-dir <dir>', 'output directory for the discovery JSON')
  .option('--save-screenshots', 'save per-page screenshots')
  .option('--save-traces', 'save Playwright traces (debug)')
  .option('--headless', 'force headless browser')
  .option('--no-headless', 'force headed browser')
  .option('--browser <type>', 'chromium | firefox | webkit')
  .option('-v, --verbose', 'verbose logging (debug level)')
  .action(async (opts) => {
    if (opts.verbose) {
      // pino is already configured; set level via env override won't help retroactively.
      // For MVP just log a notice.
      logger.level = 'debug';
    }

    try {
      const cliOverrides = buildOverrides(opts);
      const config = await loadConfig(opts.config, cliOverrides);

      logger.info(
        {
          target: config.target,
          max_pages: config.crawl.max_pages,
          headless: config.browser.headless,
          auth: config.auth.mode,
        },
        'config loaded',
      );

      const auth = buildAuth(config);

      const crawler = new Crawler({ config, auth });
      const output = await crawler.run();
      const { path } = await writeDiscoveryOutput(output, config.output);

      logger.info(
        {
          path,
          pages: output.stats.pages_discovered,
          errors: output.stats.pages_failed,
          forms: output.stats.total_forms,
          security: output.stats.security_components,
        },
        'discovery complete',
      );

      // Concise summary to stdout (useful for piping)
      console.log('');
      console.log(`Pages discovered: ${output.stats.pages_discovered}`);
      console.log(`Forms:            ${output.stats.total_forms}`);
      console.log(`Buttons:          ${output.stats.total_buttons}`);
      console.log(`Links:            ${output.stats.total_links}`);
      console.log(`Security comps:   ${output.stats.security_components}`);
      console.log(`Errors:           ${output.stats.pages_failed}`);
      console.log(`Output:           ${path}`);
    } catch (err) {
      logger.error({ err: String(err) }, 'discovery failed');
      process.exitCode = 1;
    }
  });

/* ----------------------------- init ----------------------------- */

program
  .command('init')
  .description('Write a starter discovery.yml in the current directory')
  .option('-o, --output <path>', 'destination path', 'discovery.yml')
  .option('--force', 'overwrite existing file')
  .action(async (opts) => {
    const dest = resolve(opts.output);
    if (existsSync(dest) && !opts.force) {
      logger.error({ dest }, 'file exists - pass --force to overwrite');
      process.exitCode = 1;
      return;
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, TEMPLATE_CONFIG, 'utf-8');
    logger.info({ dest }, 'config template written');
    console.log(`Wrote ${dest}`);
    console.log('Edit it then run: discovery run --config ' + opts.output);
  });

/* --------------------------- validate --------------------------- */

program
  .command('validate <file>')
  .description('Validate a discovery output JSON against the schema')
  .action(async (file: string) => {
    const path = resolve(file);
    if (!existsSync(path)) {
      logger.error({ path }, 'file not found');
      process.exitCode = 1;
      return;
    }
    try {
      const raw = await readFile(path, 'utf-8');
      const parsed = JSON.parse(raw);
      // Light structural check
      if (
        typeof parsed !== 'object' ||
        !parsed.metadata ||
        !parsed.stats ||
        !Array.isArray(parsed.pages)
      ) {
        throw new Error('missing required top-level fields (metadata, stats, pages)');
      }
      logger.info(
        {
          pages: parsed.pages.length,
          errors: Array.isArray(parsed.errors) ? parsed.errors.length : 0,
        },
        'output is valid',
      );
      console.log('OK');
    } catch (err) {
      logger.error({ err: String(err) }, 'validation failed');
      process.exitCode = 1;
    }
  });

/* --------------------------- helpers --------------------------- */

function buildOverrides(opts: Record<string, unknown>): Partial<Config> & { target?: string } {
  const overrides: Record<string, unknown> = {};

  if (opts.url) overrides.target = opts.url;

  const crawl: Record<string, unknown> = {};
  if (opts.maxPages !== undefined) crawl.max_pages = opts.maxPages;
  if (opts.maxDepth !== undefined) crawl.max_depth = opts.maxDepth;
  if (opts.strategy) crawl.strategy = opts.strategy;
  if (Object.keys(crawl).length > 0) overrides.crawl = crawl;

  const output: Record<string, unknown> = {};
  if (opts.outputDir) output.dir = opts.outputDir;
  if (opts.saveScreenshots) output.save_screenshots = true;
  if (opts.saveTraces) output.save_traces = true;
  if (Object.keys(output).length > 0) overrides.output = output;

  const browser: Record<string, unknown> = {};
  if (opts.browser) browser.type = opts.browser;
  if (opts.headless === true) browser.headless = true;
  if (opts.headless === false) browser.headless = false;
  if (Object.keys(browser).length > 0) overrides.browser = browser;

  return overrides as Partial<Config> & { target?: string };
}

const TEMPLATE_CONFIG = `# Playwright Discovery configuration
# Run: discovery run --config discovery.yml

target: https://example.com
output:
  dir: ./output
  filename_pattern: discovery_{timestamp}.json
  save_screenshots: false

crawl:
  max_pages: 20
  max_depth: 3
  strategy: bfs           # bfs | dfs
  same_domain_only: true
  follow_subdomains: false

scope:
  include: []
  exclude:
    - /admin
    - /logout

# Authentication. mode: none | basic | bearer | form | storage_state
auth:
  mode: none

  # --- form auth ---
  # mode: form
  # login_url: /login
  # username_selector: 'input[name="email"]'
  # password_selector: 'input[name="password"]'
  # submit_selector: 'button[type="submit"]'
  # username: \${TEST_USER}
  # password: \${TEST_PASSWORD}
  # success_indicator: 'url=/dashboard'   # or 'selector=.user-menu'
  # save_storage_state: ./auth-state.json

  # --- storage state reuse ---
  # mode: storage_state
  # storage_state_path: ./auth-state.json

browser:
  type: chromium          # chromium | firefox | webkit
  headless: true
  viewport:
    width: 1280
    height: 800
  locale: en-US

timing:
  navigation_timeout: 30000
  wait_for_network_idle: true
  wait_after_navigation: 1000
  action_timeout: 10000

retry:
  max_attempts: 2
  backoff_ms: 2000
`;

await program.parseAsync(process.argv);
