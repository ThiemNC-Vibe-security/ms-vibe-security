import { describe, it, expect } from 'vitest';
import { classifyInput } from '../src/classifier/semantic-input-classifier.js';
import type { InputSignals } from '../src/classifier/semantic-input-classifier.js';

const sig = (overrides: Partial<InputSignals>): InputSignals => ({
  type: null, name: null, id: null, placeholder: null, label: null, autocomplete: null,
  ...overrides,
});

describe('classifyInput — credential fields', () => {
  it('classifies type=password as password/credential/high', () => {
    const r = classifyInput(sig({ type: 'password' }));
    expect(r.semantic_type).toBe('password');
    expect(r.data_category).toBe('credential');
    expect(r.security_relevance).toBe('high');
  });

  it('classifies name=username as username/credential/high', () => {
    const r = classifyInput(sig({ type: 'text', name: 'username' }));
    expect(r.semantic_type).toBe('username');
    expect(r.data_category).toBe('credential');
  });

  it('classifies autocomplete=username as username', () => {
    const r = classifyInput(sig({ type: 'text', autocomplete: 'username' }));
    expect(r.semantic_type).toBe('username');
  });
});

describe('classifyInput — PII fields', () => {
  it('classifies type=email as email/pii', () => {
    const r = classifyInput(sig({ type: 'email' }));
    expect(r.semantic_type).toBe('email');
    expect(r.data_category).toBe('pii');
  });

  it('classifies name=email as email (text type)', () => {
    const r = classifyInput(sig({ type: 'text', name: 'email' }));
    expect(r.semantic_type).toBe('email');
  });

  it('classifies placeholder containing Email as email', () => {
    const r = classifyInput(sig({ type: 'text', placeholder: 'Enter Email' }));
    expect(r.semantic_type).toBe('email');
  });

  it('classifies type=tel as phone/pii/medium', () => {
    const r = classifyInput(sig({ type: 'tel' }));
    expect(r.semantic_type).toBe('phone');
    expect(r.security_relevance).toBe('medium');
  });

  it('classifies type=date as date/pii/medium', () => {
    const r = classifyInput(sig({ type: 'date' }));
    expect(r.semantic_type).toBe('date');
    expect(r.data_category).toBe('pii');
  });
});

describe('classifyInput — security tokens', () => {
  it('classifies hidden _csrf field as hidden_token', () => {
    const r = classifyInput(sig({ type: 'hidden', name: '_csrf' }));
    expect(r.semantic_type).toBe('hidden_token');
    expect(r.data_category).toBe('security_token');
    expect(r.security_relevance).toBe('high');
  });

  it('classifies name=otp_code as otp', () => {
    const r = classifyInput(sig({ type: 'text', name: 'otp_code' }));
    expect(r.semantic_type).toBe('otp');
    expect(r.data_category).toBe('security_token');
  });

  it('classifies autocomplete=one-time-code as otp', () => {
    const r = classifyInput(sig({ type: 'text', autocomplete: 'one-time-code' }));
    expect(r.semantic_type).toBe('otp');
  });
});

describe('classifyInput — financial fields', () => {
  it('classifies name=amount as amount/financial/high', () => {
    const r = classifyInput(sig({ type: 'number', name: 'amount' }));
    expect(r.semantic_type).toBe('amount');
    expect(r.data_category).toBe('financial');
  });

  it('classifies placeholder=price as amount', () => {
    const r = classifyInput(sig({ type: 'text', placeholder: 'Enter price' }));
    expect(r.semantic_type).toBe('amount');
  });
});

describe('classifyInput — user input fields', () => {
  it('classifies type=search as search/user_input/high', () => {
    const r = classifyInput(sig({ type: 'search' }));
    expect(r.semantic_type).toBe('search');
    expect(r.data_category).toBe('user_input');
  });

  it('classifies name=q as search', () => {
    const r = classifyInput(sig({ type: 'text', name: 'q' }));
    expect(r.semantic_type).toBe('search');
  });

  it('classifies type=file as file/user_input/high', () => {
    const r = classifyInput(sig({ type: 'file' }));
    expect(r.semantic_type).toBe('file');
    expect(r.security_relevance).toBe('high');
  });

  it('classifies name=redirect as url/user_input/high', () => {
    const r = classifyInput(sig({ type: 'text', name: 'redirect' }));
    expect(r.semantic_type).toBe('url');
  });

  it('classifies name=comment as comment/user_input/high', () => {
    const r = classifyInput(sig({ type: 'textarea', name: 'comment' }));
    expect(r.semantic_type).toBe('comment');
    expect(r.security_relevance).toBe('high');
  });

  it('classifies generic textarea as comment/medium (no specific name)', () => {
    const r = classifyInput(sig({ type: 'textarea', name: 'message_body_text' }));
    // 'message_body_text' contains 'message' so matches comment rule
    expect(r.semantic_type).toBe('comment');
  });
});

describe('classifyInput — identifiers', () => {
  it('classifies name=user_id as id/identifier/high', () => {
    const r = classifyInput(sig({ type: 'number', name: 'user_id' }));
    expect(r.semantic_type).toBe('id');
    expect(r.data_category).toBe('identifier');
  });
});

describe('classifyInput — fallback', () => {
  it('returns unknown/unknown/low for submit button', () => {
    const r = classifyInput(sig({ type: 'submit' }));
    expect(r.semantic_type).toBe('unknown');
    expect(r.data_category).toBe('unknown');
    expect(r.security_relevance).toBe('low');
  });

  it('returns unknown/user_input/medium for generic text input', () => {
    const r = classifyInput(sig({ type: 'text', name: 'foo' }));
    expect(r.semantic_type).toBe('unknown');
    expect(r.data_category).toBe('user_input');
    expect(r.security_relevance).toBe('medium');
  });
});
