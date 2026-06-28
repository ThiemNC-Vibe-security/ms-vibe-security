import { z } from 'zod';

/**
 * Discovery configuration schema.
 * Source of truth for what config a tester can pass.
 */

export const ScopeSchema = z.object({
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
});

export const CrawlSchema = z.object({
  max_pages: z.number().int().positive().default(20),
  max_depth: z.number().int().positive().default(3),
  strategy: z.enum(['bfs', 'dfs']).default('bfs'),
  same_domain_only: z.boolean().default(true),
  follow_subdomains: z.boolean().default(false),
  /** reserved_for_future_use: concurrent page crawling (currently runs sequentially) */
  parallel: z.number().int().positive().default(1).describe('reserved_for_future_use'),
  /** reserved_for_future_use: fetch robots.txt and skip disallowed paths */
  respect_robots_txt: z.boolean().default(true).describe('reserved_for_future_use'),
});

export const AuthSchema = z.object({
  mode: z.enum(['none', 'basic', 'form', 'bearer', 'storage_state']).default('none'),
  // form auth
  login_url: z.string().optional(),
  username_selector: z.string().optional(),
  password_selector: z.string().optional(),
  submit_selector: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  success_indicator: z.string().optional(),
  // bearer
  token: z.string().optional(),
  // basic
  basic_user: z.string().optional(),
  basic_password: z.string().optional(),
  // storage_state
  storage_state_path: z.string().optional(),
  // cache successful auth state
  save_storage_state: z.string().optional(),
});

export const BrowserSchema = z.object({
  type: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  headless: z.boolean().default(true),
  user_agent: z.string().nullable().default(null),
  viewport: z
    .object({
      width: z.number().int().positive().default(1280),
      height: z.number().int().positive().default(800),
    })
    .default({ width: 1280, height: 800 }),
  locale: z.string().default('en-US'),
  timezone: z.string().default('UTC'),
});

export const TimingSchema = z.object({
  navigation_timeout: z.number().int().positive().default(30000),
  wait_for_network_idle: z.boolean().default(true),
  wait_after_navigation: z.number().int().nonnegative().default(1000),
  action_timeout: z.number().int().positive().default(10000),
});

export const RetrySchema = z.object({
  max_attempts: z.number().int().positive().default(2),
  backoff_ms: z.number().int().nonnegative().default(2000),
});

export const OutputSchema = z.object({
  dir: z.string().default('./output'),
  filename_pattern: z.string().default('discovery_{timestamp}.json'),
  save_screenshots: z.boolean().default(false),
  /** reserved_for_future_use: save Playwright traces alongside the discovery output */
  save_traces: z.boolean().default(false).describe('reserved_for_future_use'),
});

export const ConfigSchema = z.object({
  target: z.string().url('target must be a valid URL'),
  scope: ScopeSchema.default({}),
  crawl: CrawlSchema.default({}),
  auth: AuthSchema.default({}),
  browser: BrowserSchema.default({}),
  timing: TimingSchema.default({}),
  retry: RetrySchema.default({}),
  output: OutputSchema.default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type AuthConfig = z.infer<typeof AuthSchema>;
export type BrowserConfig = z.infer<typeof BrowserSchema>;
export type CrawlConfig = z.infer<typeof CrawlSchema>;
export type ScopeConfig = z.infer<typeof ScopeSchema>;
export type TimingConfig = z.infer<typeof TimingSchema>;
export type OutputConfig = z.infer<typeof OutputSchema>;
