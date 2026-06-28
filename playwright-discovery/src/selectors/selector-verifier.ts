/**
 * Selector Verifier (Phase 2)
 *
 * Validates generated selectors by running `page.locator(selector).count()`
 * against the live Playwright page. This confirms the selector resolves to a
 * real element — not just a DOM-derived guess.
 *
 * Confidence rules:
 *   high   — verified + match_count === 1  (unique, safe for Playwright interactions)
 *   medium — verified + match_count > 1    (selector is valid but not unique)
 *   low    — not verified (count() threw, or verification was skipped)
 *
 * Only "important" elements are verified (forms, inputs, buttons, links) to
 * avoid excessive round-trips. Tables, navigation links, and alternates are
 * NOT verified by default.
 */

import type { Page } from 'playwright';
import type { SelectorBundle, SelectorConfidence } from '../extractors/types.js';
import { logger } from '../utils/logger.js';

/* ------------------------------------------------------------------ */

export interface VerificationResult {
  selector_verified: boolean;
  selector_unique: boolean;
  selector_match_count: number;
  selector_confidence: SelectorConfidence;
}

/**
 * Unverified baseline — used as default when verification is skipped.
 */
export const UNVERIFIED: VerificationResult = {
  selector_verified: false,
  selector_unique: false,
  selector_match_count: 0,
  selector_confidence: 'low',
};

/**
 * Derive confidence from raw verification numbers.
 */
export function classifyConfidence(verified: boolean, matchCount: number): SelectorConfidence {
  if (!verified) return 'low';
  if (matchCount === 1) return 'high';
  if (matchCount > 1) return 'medium';
  // matchCount === 0 means the selector resolved but found nothing
  return 'low';
}

/**
 * Verify a single CSS/Playwright selector against the live page.
 * Returns UNVERIFIED if the locator call throws (e.g. invalid selector syntax).
 */
export async function verifySingleSelector(
  page: Page,
  selector: string,
): Promise<VerificationResult> {
  try {
    const count = await page.locator(selector).count();
    const verified = count > 0;
    const unique = count === 1;
    return {
      selector_verified: verified,
      selector_unique: unique,
      selector_match_count: count,
      selector_confidence: classifyConfidence(verified, count),
    };
  } catch (err) {
    logger.debug({ selector, err: String(err) }, 'selector verification failed');
    return { ...UNVERIFIED };
  }
}

/**
 * Batch-verify an array of SelectorBundles against the live page.
 * Returns a parallel array of VerificationResults in the same order.
 *
 * All verifications run sequentially to avoid overwhelming the page with
 * concurrent locator calls. In practice each call is a simple DOM count so
 * the overhead is small.
 */
export async function verifySelectors(
  page: Page,
  bundles: ReadonlyArray<Pick<SelectorBundle, 'selector'>>,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const bundle of bundles) {
    const r = await verifySingleSelector(page, bundle.selector);
    results.push(r);
  }
  return results;
}

/**
 * Merge a VerificationResult into an existing SelectorBundle, returning
 * a new object (immutable). Works for any type extending SelectorBundle.
 */
export function applyVerification<T extends SelectorBundle>(
  bundle: T,
  result: VerificationResult,
): T {
  return {
    ...bundle,
    selector_verified: result.selector_verified,
    selector_unique: result.selector_unique,
    selector_match_count: result.selector_match_count,
    selector_confidence: result.selector_confidence,
  };
}
