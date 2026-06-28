/**
 * Crawler — orchestrates the full discovery process.
 *
 * Responsibilities:
 *   - Manage Playwright browser + context lifecycle
 *   - Run BFS/DFS over URL queue
 *   - Per page: navigate, extract, classify, enqueue children
 *   - Respect scope (domain, include/exclude, max pages, max depth)
 *   - Continue on errors (record them, don't abort)
 *   - Build the final DiscoveryOutput
 *
 * Auth setup is done via the `authSetup` callback passed in. The crawler
 * itself doesn't know auth modes — that's the auth/ module's job.
 */

import { chromium, firefox, webkit, type Browser, type BrowserContext } from 'playwright';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { retry } from '../utils/retry.js';
import { UrlQueue, type QueueItem } from './queue.js';
import { isInScope, isAssetUrl, normalizeUrl } from './url-utils.js';
import { extractPage, screenshotPathFor } from '../extractors/page-extractor.js';
import { classifyPage } from '../classifier/page-type.js';
import { detectSecurityComponents } from '../classifier/security-detector.js';
import { buildSecurityModels } from '../output/model-builder.js';
import { buildEvaluationMetrics } from '../output/metrics-builder.js';
import { NetworkMonitor, buildNetworkSummary } from '../probe/network-monitor.js';
import type { CapturedEndpoint } from '../probe/network-monitor.js';
import type { Config } from '../config/schema.js';
import type { AuthBundle } from '../auth/index.js';
import type {
  CrawlEdge,
  DiscoveredPage,
  DiscoveryError,
  DiscoveryOutput,
  DiscoveryStats,
} from '../output/schema.js';

export interface CrawlerOptions {
  config: Config;
  auth?: AuthBundle | null;
}

export class Crawler {
  private readonly config: Config;
  private readonly auth: AuthBundle | null;

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  private readonly queue: UrlQueue;
  private readonly pages: DiscoveredPage[] = [];
  private readonly errors: DiscoveryError[] = [];
  private readonly edges: CrawlEdge[] = [];
  /** Phase 5: accumulated captured endpoints across all pages */
  private readonly allEndpoints: CapturedEndpoint[] = [];
  /** Phase 5: total request count (including duplicates before dedup) */
  private totalRequestCount = 0;

  constructor(opts: CrawlerOptions) {
    this.config = opts.config;
    this.auth = opts.auth ?? null;
    this.queue = new UrlQueue(this.config.crawl.strategy);
  }

  async run(): Promise<DiscoveryOutput> {
    const startedAt = new Date();
    const t0 = Date.now();

    logger.info(
      {
        target: this.config.target,
        max_pages: this.config.crawl.max_pages,
        max_depth: this.config.crawl.max_depth,
        strategy: this.config.crawl.strategy,
      },
      'discovery starting',
    );

    await this.launchBrowser();

    if (this.auth?.postSetup) {
      logger.info('running auth post-setup');
      try {
        await this.auth.postSetup(this.context!);
      } catch (err) {
        logger.error({ err: String(err) }, 'auth setup failed - continuing as anonymous');
        this.errors.push({
          url: this.config.target,
          error_type: 'auth_failed',
          message: String(err),
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Seed the queue with the target URL
    const seed = normalizeUrl(this.config.target);
    if (!seed) {
      throw new Error(`Invalid target URL: ${this.config.target}`);
    }
    this.queue.enqueue({ url: seed, depth: 0 });

    try {
      await this.processQueue();
    } finally {
      await this.shutdown();
    }

    const t1 = Date.now();
    return this.buildOutput(startedAt, (t1 - t0) / 1000);
  }

  /* ------------------------- internals ------------------------- */

  private async launchBrowser(): Promise<void> {
    const browserType = this.pickBrowserType();
    logger.debug({ browser: this.config.browser.type, headless: this.config.browser.headless }, 'launching browser');
    this.browser = await browserType.launch({
      headless: this.config.browser.headless,
    });

    const baseContextOptions = {
      userAgent: this.config.browser.user_agent ?? undefined,
      viewport: this.config.browser.viewport,
      locale: this.config.browser.locale,
      timezoneId: this.config.browser.timezone,
    };

    // Merge pre-context auth options (storageState, httpCredentials, extraHTTPHeaders)
    this.context = await this.browser.newContext({
      ...baseContextOptions,
      ...(this.auth?.contextOptions ?? {}),
    });
    this.context.setDefaultNavigationTimeout(this.config.timing.navigation_timeout);
    this.context.setDefaultTimeout(this.config.timing.action_timeout);
  }

  private pickBrowserType() {
    switch (this.config.browser.type) {
      case 'firefox':
        return firefox;
      case 'webkit':
        return webkit;
      default:
        return chromium;
    }
  }

  private async shutdown(): Promise<void> {
    try {
      await this.context?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    }
    this.context = null;
    this.browser = null;
  }

  private async processQueue(): Promise<void> {
    while (!this.queue.isEmpty() && this.pages.length < this.config.crawl.max_pages) {
      const item = this.queue.dequeue();
      if (!item) break;
      await this.processItem(item);
    }
  }

  private async processItem(item: QueueItem): Promise<void> {
    if (item.depth > this.config.crawl.max_depth) {
      logger.debug({ url: item.url, depth: item.depth }, 'depth limit reached - skipping');
      return;
    }
    if (isAssetUrl(item.url)) {
      logger.debug({ url: item.url }, 'asset URL - skipping');
      return;
    }

    logger.info(
      { url: item.url, depth: item.depth, progress: `${this.pages.length + 1}/${this.config.crawl.max_pages}` },
      'discovering page',
    );

    const page = await this.context!.newPage();
    let httpStatus = 0;

    // Phase 5: attach network monitor if enabled
    const networkEnabled = this.config.network.enabled;
    const monitor = networkEnabled
      ? new NetworkMonitor(this.config.network, item.url)
      : null;
    let detachMonitor: (() => void) | null = null;
    if (monitor) {
      detachMonitor = monitor.attach(page);
    }

    try {
      const result = await retry(
        async () => {
          const resp = await page.goto(item.url, {
            waitUntil: this.config.timing.wait_for_network_idle ? 'networkidle' : 'load',
            timeout: this.config.timing.navigation_timeout,
          });
          httpStatus = resp?.status() ?? 0;
          if (this.config.timing.wait_after_navigation > 0) {
            await page.waitForTimeout(this.config.timing.wait_after_navigation);
          }
          // Extract with hooks for classifier + security
          const screenshotPath = this.config.output.save_screenshots
            ? screenshotPathFor(this.config.output.dir, this.pages.length + 1)
            : undefined;

          return extractPage(page, {
            screenshotPath,
            hooks: {
              classifyPageType: (signals) => classifyPage(signals),
              detectSecurityComponents: (p) => detectSecurityComponents(p),
            },
            interactConfig: this.config.interact,
          });
        },
        {
          attempts: this.config.retry.max_attempts,
          backoffMs: this.config.retry.backoff_ms,
          onAttemptFail: (err, attempt) =>
            logger.warn({ url: item.url, attempt, err: String(err) }, 'page attempt failed - retrying'),
        },
      );

      const final: DiscoveredPage = {
        ...result.page,
        http_status: httpStatus || result.page.http_status,
        authentication_required: this.auth !== null,
      };

      this.pages.push(final);

      // Phase 5: collect endpoints from this page
      if (monitor) {
        const pageEndpoints = monitor.flush();
        this.totalRequestCount += pageEndpoints.length;
        this.allEndpoints.push(...pageEndpoints);
        if (pageEndpoints.length > 0) {
          logger.debug({ url: item.url, endpoints: pageEndpoints.length }, 'network endpoints captured');
        }
      }

      logger.info(
        {
          url: final.url,
          type: final.page_type,
          forms: final.forms.length,
          buttons: final.buttons.length,
          links: final.links.length,
          security: final.security_components.length,
        },
        'page captured',
      );

      // Record edge from parent (if any)
      if (item.parent) {
        this.edges.push({
          from: item.parent,
          to: final.url,
          trigger_text: item.trigger ?? null,
          trigger_selector: null,
        });
      }

      // Enqueue child URLs
      this.enqueueChildren(final, item);
    } catch (err) {
      logger.error({ url: item.url, err: String(err) }, 'page failed permanently');
      this.errors.push({
        url: item.url,
        error_type: classifyError(err, httpStatus),
        message: String(err).slice(0, 500),
        timestamp: new Date().toISOString(),
      });
    } finally {
      detachMonitor?.();
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
  }

  private enqueueChildren(parent: DiscoveredPage, parentItem: QueueItem): void {
    const scope = {
      base_url: this.config.target,
      same_domain_only: this.config.crawl.same_domain_only,
      follow_subdomains: this.config.crawl.follow_subdomains,
      include: this.config.scope.include,
      exclude: this.config.scope.exclude,
    };

    let enqueued = 0;
    for (const childUrl of parent.next_candidate_pages) {
      if (this.queue.hasSeen(childUrl)) continue;
      if (!isInScope(childUrl, scope)) continue;

      const triggerLink = parent.links.find((l) => {
        const normalized = normalizeUrl(l.href, parent.url);
        return normalized === childUrl;
      });

      const added = this.queue.enqueue({
        url: childUrl,
        depth: parentItem.depth + 1,
        parent: parent.url,
        trigger: triggerLink?.text ?? null ?? undefined,
      });
      if (added) enqueued++;
    }
    if (enqueued > 0) {
      logger.debug({ enqueued, total_queue: this.queue.size() }, 'children enqueued');
    }
  }

  private buildOutput(startedAt: Date, durationSec: number): DiscoveryOutput {
    const stats: DiscoveryStats = {
      pages_discovered: this.pages.length,
      pages_failed: this.errors.length,
      total_forms: this.pages.reduce((s, p) => s + p.forms.length, 0),
      total_inputs:
        this.pages.reduce((s, p) => s + p.inputs.length, 0) +
        this.pages.reduce((s, p) => s + p.forms.reduce((sf, f) => sf + f.inputs.length, 0), 0),
      total_buttons: this.pages.reduce((s, p) => s + p.buttons.length, 0),
      total_links: this.pages.reduce((s, p) => s + p.links.length, 0),
      security_components: this.pages.reduce((s, p) => s + p.security_components.length, 0),
    };

    const configHash = createHash('sha256')
      .update(JSON.stringify(this.config))
      .digest('hex')
      .slice(0, 12);

    // Phase 4: build application model, attack surface model, security testing context
    const securityModels = buildSecurityModels(this.pages, this.edges);

    logger.info(
      {
        routes: securityModels.application_model.routes.length,
        auth_surfaces: securityModels.attack_surface_model.auth_surfaces.length,
        data_surfaces: securityModels.attack_surface_model.data_input_surfaces.length,
        file_surfaces: securityModels.attack_surface_model.file_upload_surfaces.length,
        test_categories: securityModels.security_testing_context.recommended_test_categories.length,
        priority_targets: securityModels.security_testing_context.priority_targets.length,
        candidate_flows: securityModels.security_testing_context.candidate_playwright_flows.length,
      },
      'security models built',
    );

    // Phase 5: dedup endpoints cross-page (same method+normalized_path across pages → keep last)
    const endpointDedup = new Map<string, CapturedEndpoint>();
    for (const ep of this.allEndpoints) {
      endpointDedup.set(`${ep.method}::${ep.normalized_path}`, ep);
    }
    const endpoints = Array.from(endpointDedup.values());
    const networkSummary = buildNetworkSummary(endpoints, this.totalRequestCount);

    if (this.config.network.enabled) {
      logger.info(
        {
          total_requests: networkSummary.total_requests,
          api_endpoints: networkSummary.total_api_endpoints,
          methods: networkSummary.methods,
        },
        'network capture complete',
      );
    }

    // Phase 7: compute evaluation metrics
    const evaluationMetrics = buildEvaluationMetrics({
      pages: this.pages,
      errors: this.errors,
      endpoints,
      attackSurfaceModel: securityModels.attack_surface_model,
    });

    logger.info(
      {
        pages: evaluationMetrics.pages_discovered,
        forms: evaluationMetrics.forms_discovered,
        inputs: evaluationMetrics.inputs_discovered,
        endpoints: evaluationMetrics.endpoints_discovered,
        selectors_total: evaluationMetrics.selectors_total,
        selectors_verified: evaluationMetrics.selectors_verified,
        selector_success_rate: evaluationMetrics.selector_success_rate,
        attack_surfaces: evaluationMetrics.attack_surface_count,
        errors: evaluationMetrics.crawl_errors,
      },
      'evaluation metrics computed',
    );

    return {
      metadata: {
        base_url: this.config.target,
        discovered_at: startedAt.toISOString(),
        duration_seconds: Number(durationSec.toFixed(2)),
        playwright_version: getPlaywrightVersion(),
        user_agent: this.config.browser.user_agent ?? 'playwright-default',
        config_hash: configHash,
      },
      stats,
      pages: this.pages,
      graph: { edges: this.edges },
      errors: this.errors,
      endpoints,
      network_summary: networkSummary,
      evaluation_metrics: evaluationMetrics,
      ...securityModels,
    };
  }
}

function classifyError(err: unknown, httpStatus: number): string {
  if (httpStatus >= 500) return 'http_5xx';
  if (httpStatus >= 400) return `http_${httpStatus}`;
  const msg = String(err).toLowerCase();
  if (msg.includes('timeout')) return 'timeout';
  if (msg.includes('net::')) return 'network_error';
  if (msg.includes('navigation')) return 'navigation_error';
  return 'crash';
}

function getPlaywrightVersion(): string {
  try {
    // Playwright doesn't expose version at runtime via the main API,
    // but we can read it from package.json.
    // For now keep it simple; CLI may inject a more accurate value.
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
