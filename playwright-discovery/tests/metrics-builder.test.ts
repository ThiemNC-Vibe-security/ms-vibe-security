import { describe, it, expect } from 'vitest';
import { buildEvaluationMetrics } from '../src/output/metrics-builder.js';
import type { DiscoveredPage } from '../src/output/schema.js';
import type { AttackSurfaceModel } from '../src/output/model-builder.js';

// ── Minimal stubs ────────────────────────────────────────────────────

const UNVERIFIED_BUNDLE = {
  selector: 'x', playwright_locator: '', alternate_locators: [],
  selector_verified: false, selector_unique: false,
  selector_match_count: 0, selector_confidence: 'low' as const,
};
const VERIFIED_BUNDLE = {
  ...UNVERIFIED_BUNDLE,
  selector_verified: true, selector_unique: true,
  selector_match_count: 1, selector_confidence: 'high' as const,
};

const makePage = (overrides: Partial<DiscoveredPage> = {}): DiscoveredPage => ({
  url: 'https://example.com', url_path: '/', title: '', page_type: 'unknown',
  language: 'en', authentication_required: false, http_status: 200, load_time_ms: 100,
  navigation: { navbar: [], sidebar: [], footer: [], breadcrumb: [] },
  forms: [], buttons: [], inputs: [], tables: [], links: [],
  security_components: [], url_parameters: [],
  next_candidate_pages: [], screenshot_path: null,
  dynamic_components: [], interactions_performed: [],
  ...overrides,
});

const emptyAttackSurface: AttackSurfaceModel = {
  entry_points: [], auth_surfaces: [], data_input_surfaces: [],
  file_upload_surfaces: [], admin_surfaces: [], api_surfaces: [],
};

// ── Tests ────────────────────────────────────────────────────────────

describe('buildEvaluationMetrics — basic counts', () => {
  it('returns zeros for empty discovery', () => {
    const m = buildEvaluationMetrics({ pages: [], errors: [], endpoints: [], attackSurfaceModel: emptyAttackSurface });
    expect(m.pages_discovered).toBe(0);
    expect(m.forms_discovered).toBe(0);
    expect(m.inputs_discovered).toBe(0);
    expect(m.selector_success_rate).toBeNull();
  });

  it('counts pages and errors', () => {
    const pages = [makePage(), makePage()];
    const errors = [{ url: '/fail', error_type: 'timeout', message: 'x', timestamp: '' }];
    const m = buildEvaluationMetrics({ pages, errors, endpoints: [], attackSurfaceModel: emptyAttackSurface });
    expect(m.pages_discovered).toBe(2);
    expect(m.crawl_errors).toBe(1);
  });

  it('counts forms and inputs', () => {
    const page = makePage({
      forms: [{
        ...VERIFIED_BUNDLE, form_id: 'f1', action: null, method: 'POST', enctype: null,
        inputs: [
          { ...VERIFIED_BUNDLE, tag: 'input', name: 'email', id: null, type: 'email', label: null, placeholder: null, required: true, autocomplete: null, pattern: null, min_length: null, max_length: null, default_value: null, aria_label: null, data_testid: null, semantic_type: 'email', data_category: 'pii', security_relevance: 'high' },
          { ...VERIFIED_BUNDLE, tag: 'input', name: 'password', id: null, type: 'password', label: null, placeholder: null, required: true, autocomplete: null, pattern: null, min_length: null, max_length: null, default_value: null, aria_label: null, data_testid: null, semantic_type: 'password', data_category: 'credential', security_relevance: 'high' },
        ],
        submit: null,
        csrf_token: { present: false, field_name: null },
      }],
      inputs: [{ ...UNVERIFIED_BUNDLE, tag: 'input', name: 'q', id: null, type: 'search', label: null, placeholder: null, required: false, autocomplete: null, pattern: null, min_length: null, max_length: null, default_value: null, aria_label: null, data_testid: null, semantic_type: 'search', data_category: 'user_input', security_relevance: 'high' }],
    });
    const m = buildEvaluationMetrics({ pages: [page], errors: [], endpoints: [], attackSurfaceModel: emptyAttackSurface });
    expect(m.forms_discovered).toBe(1);
    expect(m.inputs_discovered).toBe(3); // 2 form inputs + 1 standalone
  });
});

describe('buildEvaluationMetrics — selector success rate', () => {
  it('calculates rate correctly (3 verified / 4 total = 0.75)', () => {
    const page = makePage({
      buttons: [VERIFIED_BUNDLE, VERIFIED_BUNDLE, VERIFIED_BUNDLE, UNVERIFIED_BUNDLE] as any,
    });
    const m = buildEvaluationMetrics({ pages: [page], errors: [], endpoints: [], attackSurfaceModel: emptyAttackSurface });
    expect(m.selectors_total).toBe(4);
    expect(m.selectors_verified).toBe(3);
    expect(m.selector_success_rate).toBe(0.75);
  });

  it('returns null when no selectors (empty page)', () => {
    const m = buildEvaluationMetrics({ pages: [makePage()], errors: [], endpoints: [], attackSurfaceModel: emptyAttackSurface });
    expect(m.selector_success_rate).toBeNull();
  });
});

describe('buildEvaluationMetrics — attack surface count', () => {
  it('sums all surface types', () => {
    const surface: AttackSurfaceModel = {
      entry_points: [],
      auth_surfaces: [{ type: 'login_form', page_url: '/login', selector: null, risk_level: 'high', recommended_tests: [], owasp: [] }],
      data_input_surfaces: [{ type: 'search_box', page_url: '/search', selector: null, semantic_types: [], risk_level: 'medium', recommended_tests: [] }],
      file_upload_surfaces: [{ page_url: '/upload', selector: null, recommended_tests: [] }],
      admin_surfaces: [],
      api_surfaces: [{ page_url: '/api', parameters: [] }],
    };
    const m = buildEvaluationMetrics({ pages: [], errors: [], endpoints: [], attackSurfaceModel: surface });
    expect(m.attack_surface_count).toBe(4); // 1 auth + 1 data + 1 file + 0 admin + 1 api
  });
});

describe('buildEvaluationMetrics — dynamic components', () => {
  it('counts dynamic components when Phase 6 ran', () => {
    const page = makePage({ dynamic_components: [{ type: 'modal', trigger_selector: 'button', trigger_text: 'Open', title: null, forms: [], buttons: [], inputs: [] }] });
    const m = buildEvaluationMetrics({ pages: [page], errors: [], endpoints: [], attackSurfaceModel: emptyAttackSurface });
    expect(m.dynamic_components_discovered).toBe(1);
  });

  it('returns 0 when dynamic_components is empty', () => {
    const m = buildEvaluationMetrics({ pages: [makePage()], errors: [], endpoints: [], attackSurfaceModel: emptyAttackSurface });
    expect(m.dynamic_components_discovered).toBe(0);
  });
});

describe('buildEvaluationMetrics — endpoint count', () => {
  it('counts deduplicated endpoints', () => {
    const endpoints = [
      { method: 'GET', normalized_path: '/api/users' },
      { method: 'POST', normalized_path: '/api/login' },
    ] as any;
    const m = buildEvaluationMetrics({ pages: [], errors: [], endpoints, attackSurfaceModel: emptyAttackSurface });
    expect(m.endpoints_discovered).toBe(2);
  });
});
