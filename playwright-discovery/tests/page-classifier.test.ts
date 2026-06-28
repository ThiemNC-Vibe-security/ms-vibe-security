import { describe, it, expect } from 'vitest';
import { classifyByUrl, classifyByContent, classifyPage } from '../src/classifier/page-type.js';
import type { PageSignals } from '../src/extractors/page-extractor.js';

const noContent: PageSignals = {
  url: 'https://example.com/unknown',
  title: '',
  hasLoginForm: false,
  hasPasswordField: false,
  hasSearchBox: false,
  hasTable: false,
  formCount: 0,
  inputCount: 0,
};

describe('classifyByUrl', () => {
  it.each([
    ['/login',           'login'],
    ['/signin',          'login'],
    ['/register',        'registration'],
    ['/sign-up',         'registration'],
    ['/forgot-password', 'password_recovery'],
    ['/admin',           'admin'],
    ['/admin/users',     'admin'],
    ['/checkout',        'payment'],
    ['/profile',         'profile'],
    ['/settings',        'settings'],
    ['/dashboard',       'dashboard'],
    ['/search',          'search'],
    ['/404',             'error'],
  ])('classifies %s as %s', (path, expected) => {
    expect(classifyByUrl(`https://example.com${path}`)).toBe(expected);
  });

  it('returns null for unrecognised path', () => {
    expect(classifyByUrl('https://example.com/products/shoes')).toBeNull();
  });
});

describe('classifyByContent', () => {
  it('returns login for page with password field and few inputs', () => {
    const signals: PageSignals = { ...noContent, hasPasswordField: true, formCount: 1, inputCount: 2 };
    expect(classifyByContent(signals)).toBe('login');
  });

  it('returns registration when title hints sign-up', () => {
    const signals: PageSignals = { ...noContent, hasPasswordField: true, formCount: 1, inputCount: 2, title: 'sign-up' };
    expect(classifyByContent(signals)).toBe('registration');
  });

  it('returns search for search box + table', () => {
    const signals: PageSignals = { ...noContent, hasSearchBox: true, hasTable: true };
    expect(classifyByContent(signals)).toBe('search');
  });

  it('returns list for table with no forms', () => {
    const signals: PageSignals = { ...noContent, hasTable: true, formCount: 0 };
    expect(classifyByContent(signals)).toBe('list');
  });

  it('returns generic_form when forms present', () => {
    const signals: PageSignals = { ...noContent, formCount: 2 };
    expect(classifyByContent(signals)).toBe('generic_form');
  });

  it('returns landing for root path', () => {
    const signals: PageSignals = { ...noContent, url: 'https://example.com/' };
    expect(classifyByContent(signals)).toBe('landing');
  });
});

describe('classifyPage (combined)', () => {
  it('URL wins when it matches', () => {
    const signals: PageSignals = { ...noContent, url: 'https://example.com/admin' };
    expect(classifyPage(signals)).toBe('admin');
  });

  it('falls back to content when URL unknown and has password field', () => {
    const signals: PageSignals = {
      ...noContent,
      url: 'https://example.com/auth',
      hasPasswordField: true,
      formCount: 1,
      inputCount: 2,
    };
    expect(classifyPage(signals)).toBe('login');
  });

  it('login URL without password → content classification', () => {
    // URL says login but no password field → fall back to content
    const signals: PageSignals = { ...noContent, url: 'https://example.com/login', hasPasswordField: false };
    // Content: no forms, no table → returns content/landing
    expect(['content', 'landing', 'unknown']).toContain(classifyPage(signals));
  });
});
