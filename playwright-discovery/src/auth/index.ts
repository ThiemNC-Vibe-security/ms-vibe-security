/**
 * Auth handlers.
 *
 * Each mode returns an `AuthBundle`:
 *   - contextOptions: extra options passed to browser.newContext()
 *     (e.g. storageState, httpCredentials, extraHTTPHeaders)
 *   - postSetup: optional callback that runs after context creation but
 *     before crawling starts (used for form login)
 *
 * After a successful form login, the resulting storage state can be saved
 * to disk so subsequent runs can skip the login entirely.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { BrowserContext, BrowserContextOptions } from 'playwright';
import { logger } from '../utils/logger.js';
import type { AuthConfig, Config } from '../config/schema.js';

export interface AuthBundle {
  contextOptions: Partial<BrowserContextOptions>;
  postSetup?: (context: BrowserContext) => Promise<void>;
}

/**
 * Build the AuthBundle for a given config. Returns null when no auth is needed.
 */
export function buildAuth(config: Config): AuthBundle | null {
  const auth = config.auth;
  switch (auth.mode) {
    case 'none':
      return null;

    case 'basic':
      return buildBasicAuth(auth);

    case 'bearer':
      return buildBearerAuth(auth);

    case 'storage_state':
      return buildStorageStateAuth(auth);

    case 'form':
      return buildFormAuth(auth, config);

    default:
      logger.warn({ mode: auth.mode }, 'unknown auth mode - using none');
      return null;
  }
}

/* ----------------------------- basic ----------------------------- */

function buildBasicAuth(auth: AuthConfig): AuthBundle {
  if (!auth.basic_user || !auth.basic_password) {
    throw new Error('auth.mode=basic requires basic_user and basic_password');
  }
  return {
    contextOptions: {
      httpCredentials: {
        username: auth.basic_user,
        password: auth.basic_password,
      },
    },
  };
}

/* ---------------------------- bearer ---------------------------- */

function buildBearerAuth(auth: AuthConfig): AuthBundle {
  if (!auth.token) {
    throw new Error('auth.mode=bearer requires token');
  }
  return {
    contextOptions: {
      extraHTTPHeaders: {
        Authorization: `Bearer ${auth.token}`,
      },
    },
  };
}

/* ------------------------- storage_state ------------------------- */

function buildStorageStateAuth(auth: AuthConfig): AuthBundle {
  if (!auth.storage_state_path) {
    throw new Error('auth.mode=storage_state requires storage_state_path');
  }
  const path = resolve(auth.storage_state_path);
  if (!existsSync(path)) {
    throw new Error(`storage_state_path not found: ${path}`);
  }
  logger.info({ path }, 'reusing storage state');
  return {
    contextOptions: { storageState: path },
  };
}

/* ----------------------------- form ----------------------------- */

function buildFormAuth(auth: AuthConfig, config: Config): AuthBundle {
  if (!auth.login_url) throw new Error('auth.mode=form requires login_url');
  if (!auth.username_selector)
    throw new Error('auth.mode=form requires username_selector');
  if (!auth.password_selector)
    throw new Error('auth.mode=form requires password_selector');
  if (!auth.username) throw new Error('auth.mode=form requires username');
  if (!auth.password) throw new Error('auth.mode=form requires password');

  // If a saved storage state exists, reuse it instead of re-logging in.
  const savePath = auth.save_storage_state ? resolve(auth.save_storage_state) : null;
  if (savePath && existsSync(savePath)) {
    logger.info({ path: savePath }, 'reusing saved storage state for form auth');
    return { contextOptions: { storageState: savePath } };
  }

  const loginUrl = absoluteUrl(auth.login_url, config.target);

  return {
    contextOptions: {},
    postSetup: async (context) => {
      const page = await context.newPage();
      try {
        logger.info({ loginUrl }, 'navigating to login page');
        await page.goto(loginUrl, {
          waitUntil: 'networkidle',
          timeout: config.timing.navigation_timeout,
        });

        logger.debug('filling credentials');
        await page.fill(auth.username_selector!, auth.username!);
        await page.fill(auth.password_selector!, auth.password!);

        const submitSel = auth.submit_selector ?? 'button[type="submit"]';
        logger.debug({ submit: submitSel }, 'submitting login form');

        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: config.timing.navigation_timeout }),
          page.click(submitSel),
        ]);

        // Verify success
        await verifyAuthSuccess(page, auth);
        logger.info('form auth successful');

        // Save storage state for reuse
        if (savePath) {
          await mkdir(dirname(savePath), { recursive: true });
          await context.storageState({ path: savePath });
          logger.info({ path: savePath }, 'storage state saved');
        }
      } finally {
        await page.close();
      }
    },
  };
}

async function verifyAuthSuccess(
  page: import('playwright').Page,
  auth: AuthConfig,
): Promise<void> {
  if (!auth.success_indicator) {
    // No indicator configured — assume success if we got here without error.
    return;
  }

  const indicator = auth.success_indicator;

  if (indicator.startsWith('url=')) {
    const expected = indicator.slice('url='.length);
    const current = new URL(page.url()).pathname;
    if (!current.includes(expected)) {
      throw new Error(
        `auth success indicator failed: expected URL contains "${expected}", got "${current}"`,
      );
    }
    return;
  }

  if (indicator.startsWith('selector=')) {
    const sel = indicator.slice('selector='.length);
    await page.waitForSelector(sel, { timeout: 10000 });
    return;
  }

  // Fallback: treat as selector
  await page.waitForSelector(indicator, { timeout: 10000 });
}

/* ----------------------------- utils ----------------------------- */

function absoluteUrl(input: string, base: string): string {
  try {
    return new URL(input, base).toString();
  } catch {
    return input;
  }
}

// Helper export so the crawler can call this on shutdown if needed
export async function persistStorageState(
  context: BrowserContext,
  path: string,
): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await context.storageState({ path: resolve(path) });
}

// Marker for unused import (silence linter when not strict)
void writeFile;
