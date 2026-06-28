/**
 * Page-level extractor: takes an already-loaded Playwright Page and produces
 * a `DiscoveredPage`. Stateless. Does not navigate, does not enqueue links —
 * that is the crawler's job.
 *
 * Page type classification and security component detection are pluggable
 * via the `enrich` callback (filled in by tasks #7 and #8).
 */

import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Page } from 'playwright';
import { logger } from '../utils/logger.js';
import { normalizeUrl, urlPath } from '../crawler/url-utils.js';
import { extractRawPageSnapshot } from './browser-extract.js';
import {
  buildButtons,
  buildForms,
  buildLinks,
  buildNavigation,
  buildStandaloneInputs,
  buildTables,
} from './transformer.js';
import type { DiscoveredPage, SecurityComponent, UrlParameter } from '../output/schema.js';

export interface PageEnrichmentHooks {
  /** Classify page type from URL + raw signals. */
  classifyPageType?: (signals: PageSignals) => string;
  /** Detect security-relevant components from the structured page. */
  detectSecurityComponents?: (page: DiscoveredPage) => SecurityComponent[];
}

export interface PageSignals {
  url: string;
  title: string;
  hasLoginForm: boolean;
  hasPasswordField: boolean;
  hasSearchBox: boolean;
  hasTable: boolean;
  formCount: number;
  inputCount: number;
}

export interface PageExtractOptions {
  /** When set, take a screenshot and store the relative path in the result. */
  screenshotPath?: string;
  hooks?: PageEnrichmentHooks;
}

export interface PageExtractResult {
  page: DiscoveredPage;
  /** Absolute URLs discovered on this page, after normalization. */
  outboundUrls: string[];
}

export async function extractPage(
  pwPage: Page,
  options: PageExtractOptions = {},
): Promise<PageExtractResult> {
  const start = Date.now();

  // Take screenshot if requested
  let screenshotPath: string | null = null;
  if (options.screenshotPath) {
    try {
      // Ensure the screenshots directory exists before writing (Task 1.1 fix)
      await mkdir(dirname(options.screenshotPath), { recursive: true });
      await pwPage.screenshot({ path: options.screenshotPath, fullPage: false });
      screenshotPath = options.screenshotPath;
    } catch (err) {
      logger.warn({ err: String(err), path: options.screenshotPath }, 'screenshot failed');
    }
  }

  // Run mass extraction in the browser.
  // tsx/esbuild injects `__name(fn, "name")` wrappers that don't exist in browser.
  // We inject a shim for __name before evaluating the function string.
  const fnStr = extractRawPageSnapshot.toString();
  const raw: import('./types.js').RawPageSnapshot = await pwPage.evaluate(
    `(function() { var __name = function(fn, n) { return fn; }; return (${fnStr})(); })()`,
  );

  // Transform raw → typed (with selectors generated Node-side)
  const forms = buildForms(raw.forms);
  const buttons = buildButtons(raw.buttons);
  const links = buildLinks(raw.links);
  const inputs = buildStandaloneInputs(raw.inputsOutsideForms);
  const navigation = buildNavigation(raw.navigation);
  const tables = buildTables(raw.tables);

  // Build classification signals
  const passwordField = forms.some((f) => f.inputs.some((i) => i.type === 'password')) ||
    inputs.some((i) => i.type === 'password');
  const searchBox = inputs.some((i) => i.type === 'search') ||
    forms.some((f) => f.inputs.some((i) => i.type === 'search'));
  const signals: PageSignals = {
    url: raw.url,
    title: raw.title,
    hasLoginForm: passwordField,
    hasPasswordField: passwordField,
    hasSearchBox: searchBox,
    hasTable: tables.length > 0,
    formCount: forms.length,
    inputCount: inputs.length + forms.reduce((sum, f) => sum + f.inputs.length, 0),
  };

  const pageType = options.hooks?.classifyPageType?.(signals) ?? 'unknown';

  // URL parameters
  const urlParameters = extractUrlParameters(raw.url);

  // Outbound URLs (normalize against current page URL)
  const outboundUrls = uniq(
    raw.linkUrls
      .map((u) => normalizeUrl(u, raw.url))
      .filter((u): u is string => u !== null),
  );

  // Pre-final page (security components added after, since they may inspect the full page)
  const preFinal: DiscoveredPage = {
    url: raw.url,
    url_path: urlPath(raw.url),
    title: raw.title,
    page_type: pageType,
    language: raw.language,
    authentication_required: false, // updated by crawler if auth was enforced
    http_status: 200, // updated by crawler from response
    load_time_ms: Date.now() - start,

    navigation,
    forms,
    buttons,
    inputs,
    tables,
    links,

    security_components: [],
    url_parameters: urlParameters,

    next_candidate_pages: outboundUrls,
    screenshot_path: screenshotPath,
  };

  const securityComponents = options.hooks?.detectSecurityComponents?.(preFinal) ?? [];

  const page: DiscoveredPage = {
    ...preFinal,
    security_components: securityComponents,
  };

  return { page, outboundUrls };
}

function extractUrlParameters(rawUrl: string): UrlParameter[] {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return [];
  }
  const params: UrlParameter[] = [];
  for (const [name, value] of parsed.searchParams) {
    params.push({
      name,
      value,
      in: 'query',
      applicable_attacks: detectAttacksForParam(name, value),
    });
  }
  // Fragment (hash) — may flow into client-side sinks (DOM XSS).
  if (parsed.hash && parsed.hash.length > 1) {
    params.push({
      name: '__fragment__',
      value: parsed.hash.slice(1),
      in: 'fragment',
      applicable_attacks: ['xss_dom', 'open_redirect'],
    });
  }
  return params;
}

/**
 * Quick heuristic for which attacks could apply to a URL parameter.
 * Returns attack ids matching test-generator/knowledge/attacks/*.yml.
 * The downstream LLM may refine this.
 */
function detectAttacksForParam(name: string, value: string): string[] {
  const attacks: string[] = [];
  const lower = name.toLowerCase();

  // Redirect / next / callback URL parameters
  if (/^(redirect|redirect_uri|redirect_url|next|return|return_to|return_url|url|callback|callback_url|continue|goto)$/i.test(lower)) {
    attacks.push('open_redirect', 'ssrf', 'xss_reflected');
  }

  // Webhook / import / source URLs → server-side fetch → SSRF
  if (/^(webhook|webhook_url|notify|notify_url|import|import_url|source|source_url|fetch|proxy|target|target_url|host)$/i.test(lower)) {
    attacks.push('ssrf', 'open_redirect');
  }

  // ID-like parameters
  if (/^(id|user_?id|account_?id|uid|user|order_?id|invoice_?id|resource_?id|item_?id|record_?id)$/i.test(lower)) {
    attacks.push('idor', 'sql_injection');
  }

  // File / path parameters
  if (/^(file|filename|filepath|path|page|template|view|include|load|doc|document|attachment|download)$/i.test(lower)) {
    attacks.push('path_traversal', 'idor', 'command_injection');
  }

  // Search / query parameters
  if (/^(q|query|search|term|keyword|s)$/i.test(lower)) {
    attacks.push('xss_reflected', 'xss_dom', 'sql_injection', 'nosql_injection');
  }

  // Generic param with non-alphanumeric content → injection candidate
  if (value.length > 0 && /[^a-z0-9-_]/i.test(value)) {
    attacks.push('xss_reflected', 'sql_injection', 'stack_trace_leak');
  }

  return uniq(attacks);
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Helper to compute a screenshot path for a page index, given output dir.
 */
export function screenshotPathFor(outputDir: string, index: number): string {
  return join(outputDir, 'screenshots', `page_${String(index).padStart(3, '0')}.png`);
}
