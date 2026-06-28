import { describe, it, expect } from 'vitest';
import { normalizePath, buildNetworkSummary } from '../src/probe/network-monitor.js';
import type { CapturedEndpoint } from '../src/probe/network-monitor.js';

describe('normalizePath', () => {
  it.each([
    ['/api/users/123',          '/api/users/:id'],
    ['/api/users/42/posts',     '/api/users/:id/posts'],
    ['/api/auth/login',         '/api/auth/login'],
    ['/api/items/507f1f77bcf86cd799439011', '/api/items/:id'],   // 24-char hex (ObjectId)
    ['/api/users/550e8400-e29b-41d4-a716-446655440000', '/api/users/:id'], // UUID v4
    ['/api/categories',         '/api/categories'],
    ['/',                       '/'],
    ['/api/v2/orders/999/items/42', '/api/v2/orders/:id/items/:id'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it('does not replace non-numeric short segments', () => {
    expect(normalizePath('/api/v1/users')).toBe('/api/v1/users');
  });

  it('does not replace short hex that is not exactly 24 chars', () => {
    expect(normalizePath('/api/items/abc123')).toBe('/api/items/abc123');
  });
});

describe('buildNetworkSummary', () => {
  const makeEndpoint = (method: string): CapturedEndpoint => ({
    method,
    url: 'https://example.com/api/test',
    path: '/api/test',
    normalized_path: '/api/test',
    resource_type: 'fetch',
    initiator_page_url: 'https://example.com',
    request_headers: {},
    request_body_sample: null,
    response_status: 200,
    response_content_type: 'application/json',
    response_body_sample: null,
    query_parameters: [],
    auth_related: false,
    sensitive_data_detected: [],
    discovered_at: new Date().toISOString(),
  });

  it('counts methods correctly', () => {
    const endpoints = [
      makeEndpoint('GET'),
      makeEndpoint('GET'),
      makeEndpoint('POST'),
      makeEndpoint('DELETE'),
      makeEndpoint('PATCH'),
      makeEndpoint('PUT'),
      makeEndpoint('OPTIONS'),
    ];
    const summary = buildNetworkSummary(endpoints, 20);
    expect(summary.methods.GET).toBe(2);
    expect(summary.methods.POST).toBe(1);
    expect(summary.methods.DELETE).toBe(1);
    expect(summary.methods.PATCH).toBe(1);
    expect(summary.methods.PUT).toBe(1);
    expect(summary.methods.OTHER).toBe(1);
  });

  it('returns correct totals', () => {
    const endpoints = [makeEndpoint('GET'), makeEndpoint('POST')];
    const summary = buildNetworkSummary(endpoints, 100);
    expect(summary.total_requests).toBe(100);
    expect(summary.total_api_endpoints).toBe(2);
  });

  it('handles empty endpoint list', () => {
    const summary = buildNetworkSummary([], 0);
    expect(summary.total_api_endpoints).toBe(0);
    expect(summary.total_requests).toBe(0);
    expect(summary.methods.GET).toBe(0);
  });
});
