import { describe, it, expect } from 'vitest';
import { generateSelector } from '../src/selectors/generator.js';
import type { ElementInfo } from '../src/selectors/types.js';

const base: ElementInfo = {
  tag: 'input',
  id: null,
  name: null,
  type: 'text',
  role: 'textbox',
  ariaLabel: null,
  text: null,
  placeholder: null,
  title: null,
  href: null,
  className: null,
  testId: null,
  testIdAttribute: null,
  label: null,
  cssPath: 'form > div > input',
  isUnique: true,
};

describe('generateSelector — strategy priority', () => {
  it('prefers test-id when present', () => {
    const info: ElementInfo = { ...base, testId: 'login-email', testIdAttribute: 'data-testid' };
    const result = generateSelector(info);
    expect(result.strategy).toBe('test-id');
    expect(result.selector).toBe('[data-testid="login-email"]');
    expect(result.playwrightLocator).toContain('getByTestId');
  });

  it('uses role+name when no test-id', () => {
    const info: ElementInfo = { ...base, role: 'button', text: 'Submit', ariaLabel: null };
    const result = generateSelector(info);
    expect(result.strategy).toBe('role-name');
  });

  it('uses label for input with label', () => {
    const info: ElementInfo = { ...base, label: 'Email address', role: null };
    const result = generateSelector(info);
    expect(result.strategy).toBe('label');
    expect(result.playwrightLocator).toContain('getByLabel');
  });

  it('uses placeholder when no label', () => {
    const info: ElementInfo = { ...base, placeholder: 'Enter email', role: null };
    const result = generateSelector(info);
    expect(result.strategy).toBe('placeholder');
    expect(result.playwrightLocator).toContain('getByPlaceholder');
  });

  it('uses text for button with text content', () => {
    const info: ElementInfo = { ...base, tag: 'button', text: 'Login', role: null };
    const result = generateSelector(info);
    expect(result.strategy).toBe('text');
  });

  it('uses stable id', () => {
    const info: ElementInfo = { ...base, id: 'email-field', role: null };
    const result = generateSelector(info);
    expect(result.strategy).toBe('id');
    expect(result.selector).toBe('#email-field');
  });

  it('skips auto-generated id (uuid-like)', () => {
    const info: ElementInfo = { ...base, id: 'a1b2c3d4e5f6a1b2c3d4e5f6', name: 'email', role: null };
    const result = generateSelector(info);
    expect(result.strategy).toBe('name');
  });

  it('uses name attribute', () => {
    const info: ElementInfo = { ...base, name: 'email', role: null };
    const result = generateSelector(info);
    expect(result.strategy).toBe('name');
    expect(result.selector).toBe('input[name="email"]');
  });

  it('falls back to css-path when nothing else available', () => {
    const info: ElementInfo = { ...base, role: null };
    const result = generateSelector(info);
    expect(result.strategy).toBe('css-path');
    expect(result.selector).toBe('form > div > input');
  });

  it('includes alternates', () => {
    const info: ElementInfo = { ...base, testId: 'btn', testIdAttribute: 'data-testid', role: 'button', text: 'Go', tag: 'button' };
    const result = generateSelector(info);
    expect(result.alternates.length).toBeGreaterThan(0);
  });
});

describe('generateSelector — escaping', () => {
  it('escapes double quotes in attribute values', () => {
    const info: ElementInfo = { ...base, name: 'field"name', role: null };
    const result = generateSelector(info);
    expect(result.selector).not.toContain('field"name');
  });
});
