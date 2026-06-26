/**
 * Heuristic page-type classifier.
 *
 * Combines URL pattern matching and content signals from extracted snapshot.
 * No LLM. Optional LLM enrichment can be layered on top later.
 *
 * Returns a single page_type label. See overview.md "Page type classification".
 */

import type { PageSignals } from '../extractors/page-extractor.js';

export type PageType =
  | 'login'
  | 'registration'
  | 'password_recovery'
  | 'dashboard'
  | 'profile'
  | 'settings'
  | 'admin'
  | 'payment'
  | 'checkout'
  | 'cart'
  | 'search'
  | 'list'
  | 'detail'
  | 'generic_form'
  | 'error'
  | 'landing'
  | 'content'
  | 'unknown';

interface UrlRule {
  test: RegExp;
  type: PageType;
}

const URL_RULES: UrlRule[] = [
  { test: /\/(sign[-_]?in|log[-_]?in|auth\/login)(?:[/?#]|$)/i, type: 'login' },
  { test: /\/(sign[-_]?up|register|signup|create[-_]?account)(?:[/?#]|$)/i, type: 'registration' },
  { test: /\/(forgot|reset)[-_]?password(?:[/?#]|$)/i, type: 'password_recovery' },
  { test: /\/admin(?:[/?#]|$)/i, type: 'admin' },
  { test: /\/(checkout|cart|basket|payment|billing)(?:[/?#]|$)/i, type: 'payment' },
  { test: /\/(profile|account|me)(?:[/?#]|$)/i, type: 'profile' },
  { test: /\/(settings|preferences|config)(?:[/?#]|$)/i, type: 'settings' },
  { test: /\/(dashboard|home|overview)(?:[/?#]|$)/i, type: 'dashboard' },
  { test: /\/(search|find)(?:[/?#]|$)/i, type: 'search' },
  { test: /\/(error|404|500|not[-_]?found|forbidden)(?:[/?#]|$)/i, type: 'error' },
];

/**
 * Page type via URL pattern. Returns null if no pattern matches.
 */
export function classifyByUrl(url: string): PageType | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  for (const rule of URL_RULES) {
    if (rule.test.test(path)) return rule.type;
  }
  return null;
}

/**
 * Page type via content signals when URL doesn't decide.
 */
export function classifyByContent(signals: PageSignals): PageType {
  // Login: password field and 1-2 inputs total
  if (signals.hasPasswordField && signals.inputCount <= 4 && signals.formCount === 1) {
    // Heuristic: if title hints registration vs login
    if (/register|sign[-_]?up/i.test(signals.title)) return 'registration';
    return 'login';
  }

  // Registration: password field + several inputs (likely confirm password, email, name)
  if (signals.hasPasswordField && signals.inputCount >= 3) {
    return 'registration';
  }

  // Search results: search box + table or many links
  if (signals.hasSearchBox && (signals.hasTable || signals.inputCount === 1)) {
    return 'search';
  }

  // List/report: visible table(s), few/no forms
  if (signals.hasTable && signals.formCount === 0) {
    return 'list';
  }

  // Generic form: forms present but doesn't match above
  if (signals.formCount >= 1) {
    return 'generic_form';
  }

  // Otherwise: content page (landing if root-ish, content elsewhere)
  try {
    const p = new URL(signals.url).pathname;
    if (p === '/' || p === '') return 'landing';
  } catch {
    /* ignore */
  }

  return 'content';
}

/**
 * Combined classifier — URL first, fall back to content signals.
 */
export function classifyPage(signals: PageSignals): PageType {
  const byUrl = classifyByUrl(signals.url);
  if (byUrl) {
    // Refinement: even if URL says login, if a password field is missing it's likely landing
    if (byUrl === 'login' && !signals.hasPasswordField) {
      return classifyByContent(signals);
    }
    return byUrl;
  }
  return classifyByContent(signals);
}
