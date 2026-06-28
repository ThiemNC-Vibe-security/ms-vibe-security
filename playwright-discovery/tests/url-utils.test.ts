import { describe, it, expect } from 'vitest';
import { normalizeUrl, isAssetUrl, isInScope, matchGlob, urlPath } from '../src/crawler/url-utils.js';

describe('normalizeUrl', () => {
  it('resolves relative URL against base', () => {
    expect(normalizeUrl('/dashboard', 'https://example.com')).toBe('https://example.com/dashboard');
  });

  it('strips fragment', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('strips tracking params', () => {
    const result = normalizeUrl('https://example.com/page?utm_source=google&id=1');
    expect(result).toBe('https://example.com/page?id=1');
  });

  it('sorts query params alphabetically', () => {
    const result = normalizeUrl('https://example.com/?z=1&a=2');
    expect(result).toBe('https://example.com/?a=2&z=1');
  });

  it('trims trailing slash (non-root)', () => {
    expect(normalizeUrl('https://example.com/foo/')).toBe('https://example.com/foo');
  });

  it('preserves root slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('returns null for mailto:', () => {
    expect(normalizeUrl('mailto:test@example.com')).toBeNull();
  });

  it('returns null for javascript:', () => {
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
  });

  it('returns null for invalid URL', () => {
    expect(normalizeUrl('not-a-url')).toBeNull();
  });

  it('lowercases host', () => {
    const result = normalizeUrl('https://EXAMPLE.COM/path');
    expect(result).toBe('https://example.com/path');
  });
});

describe('isAssetUrl', () => {
  it('returns true for image extensions', () => {
    expect(isAssetUrl('https://example.com/img/logo.png')).toBe(true);
    expect(isAssetUrl('https://example.com/style.css')).toBe(true);
    expect(isAssetUrl('https://example.com/app.js')).toBe(true);
    expect(isAssetUrl('https://example.com/font.woff2')).toBe(true);
  });

  it('returns false for HTML pages', () => {
    expect(isAssetUrl('https://example.com/about')).toBe(false);
    expect(isAssetUrl('https://example.com/login')).toBe(false);
  });

  it('returns false for invalid URL', () => {
    expect(isAssetUrl('not-a-url')).toBe(false);
  });
});

describe('matchGlob', () => {
  it('matches exact path', () => {
    expect(matchGlob('/admin', '/admin')).toBe(true);
    expect(matchGlob('/admin', '/user')).toBe(false);
  });

  it('* matches single segment', () => {
    expect(matchGlob('/api/*', '/api/users')).toBe(true);
    expect(matchGlob('/api/*', '/api/users/123')).toBe(false);
  });

  it('** matches multiple segments', () => {
    expect(matchGlob('/admin/**', '/admin/users/123')).toBe(true);
    expect(matchGlob('/admin/**', '/admin')).toBe(false);
  });
});

describe('isInScope', () => {
  const baseRules = {
    base_url: 'https://example.com',
    same_domain_only: true,
    follow_subdomains: false,
    include: [],
    exclude: [],
  };

  it('allows same-domain URL', () => {
    expect(isInScope('https://example.com/dashboard', baseRules)).toBe(true);
  });

  it('blocks different domain', () => {
    expect(isInScope('https://other.com/page', baseRules)).toBe(false);
  });

  it('respects exclude patterns', () => {
    const rules = { ...baseRules, exclude: ['/admin/**'] };
    expect(isInScope('https://example.com/admin/users', rules)).toBe(false);
    expect(isInScope('https://example.com/dashboard', rules)).toBe(true);
  });

  it('respects include patterns', () => {
    const rules = { ...baseRules, include: ['/api/**'] };
    expect(isInScope('https://example.com/api/users', rules)).toBe(true);
    expect(isInScope('https://example.com/dashboard', rules)).toBe(false);
  });

  it('exclude takes precedence over include', () => {
    const rules = { ...baseRules, include: ['/api/**'], exclude: ['/api/internal/**'] };
    expect(isInScope('https://example.com/api/users', rules)).toBe(true);
    expect(isInScope('https://example.com/api/internal/secret', rules)).toBe(false);
  });
});

describe('urlPath', () => {
  it('extracts pathname and query', () => {
    expect(urlPath('https://example.com/users?page=1')).toBe('/users?page=1');
  });

  it('returns input on invalid URL', () => {
    expect(urlPath('not-a-url')).toBe('not-a-url');
  });
});
