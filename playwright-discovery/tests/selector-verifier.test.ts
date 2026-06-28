import { describe, it, expect } from 'vitest';
import { classifyConfidence, applyVerification, UNVERIFIED } from '../src/selectors/selector-verifier.js';
import type { SelectorBundle } from '../src/extractors/types.js';

describe('classifyConfidence', () => {
  it('high when verified and count=1', () => {
    expect(classifyConfidence(true, 1)).toBe('high');
  });

  it('medium when verified and count>1', () => {
    expect(classifyConfidence(true, 5)).toBe('medium');
  });

  it('low when not verified', () => {
    expect(classifyConfidence(false, 0)).toBe('low');
    expect(classifyConfidence(false, 1)).toBe('low');
  });

  it('low when verified but count=0 (element disappeared)', () => {
    expect(classifyConfidence(true, 0)).toBe('low');
  });
});

describe('UNVERIFIED constant', () => {
  it('has correct defaults', () => {
    expect(UNVERIFIED.selector_verified).toBe(false);
    expect(UNVERIFIED.selector_unique).toBe(false);
    expect(UNVERIFIED.selector_match_count).toBe(0);
    expect(UNVERIFIED.selector_confidence).toBe('low');
  });
});

describe('applyVerification', () => {
  const bundle: SelectorBundle = {
    selector: 'input[name="email"]',
    playwright_locator: "page.locator('input[name=\"email\"]')",
    alternate_locators: [],
    ...UNVERIFIED,
  };

  it('merges verification result into bundle', () => {
    const result = applyVerification(bundle, {
      selector_verified: true,
      selector_unique: true,
      selector_match_count: 1,
      selector_confidence: 'high',
    });
    expect(result.selector_verified).toBe(true);
    expect(result.selector_confidence).toBe('high');
    expect(result.selector).toBe('input[name="email"]'); // original preserved
  });

  it('does not mutate original bundle', () => {
    applyVerification(bundle, {
      selector_verified: true,
      selector_unique: true,
      selector_match_count: 1,
      selector_confidence: 'high',
    });
    expect(bundle.selector_verified).toBe(false); // unchanged
  });
});
