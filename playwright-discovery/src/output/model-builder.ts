/**
 * Application Security Model Builder (Phase 4)
 *
 * Consumes the raw discovery output (pages + graph) and produces three
 * higher-level models that are fed to the LLM test generator:
 *
 *   application_model      — structured view of the app (pages, routes, forms,
 *                            navigation graph)
 *   attack_surface_model   — enumerated attack surfaces derived from security
 *                            components detected on each page
 *   security_testing_context — aggregated test categories, priority targets,
 *                              and candidate Playwright flows
 *
 * Design rules:
 *   - Only data already present in the discovery output is used.
 *     Nothing is hallucinated.
 *   - attack_id values must match knowledge/attacks/*.yml `id` fields so the
 *     LLM planner can join them.
 *   - The existing `pages`, `stats`, `graph`, and `errors` fields are kept
 *     unchanged (backward-compatible additive fields only).
 */

import type { DiscoveredPage, CrawlEdge, SecurityComponent } from './schema.js';

/* ------------------------------------------------------------------ */
/*  Sub-types: ApplicationModel                                         */
/* ------------------------------------------------------------------ */

export interface AppRoute {
  path: string;
  /** Representative full URL (first page discovered at this path) */
  url: string;
  page_type: string;
  authentication_required: boolean;
}

export interface AppForm {
  form_id: string;
  page_url: string;
  action: string | null;
  method: string;
  input_count: number;
  has_csrf_token: boolean;
  /** Selectors of inputs with security_relevance = 'high' */
  high_relevance_inputs: string[];
}

export interface NavEdge {
  from: string;
  to: string;
  trigger_text: string | null;
}

export interface ApplicationModel {
  /** Deduplicated route list (one entry per unique url_path) */
  routes: AppRoute[];
  /** All forms across all pages */
  forms: AppForm[];
  /** Navigation graph edges (mirrors CrawlGraph.edges) */
  navigation_graph: NavEdge[];
}

/* ------------------------------------------------------------------ */
/*  Sub-types: AttackSurfaceModel                                       */
/* ------------------------------------------------------------------ */

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export interface AuthSurface {
  type: string;
  page_url: string;
  selector: string | null;
  risk_level: RiskLevel;
  recommended_tests: string[];
  owasp: string[];
}

export interface DataInputSurface {
  type: string;
  page_url: string;
  selector: string | null;
  semantic_types: string[];
  risk_level: RiskLevel;
  recommended_tests: string[];
}

export interface FileUploadSurface {
  page_url: string;
  selector: string | null;
  recommended_tests: string[];
}

export interface AdminSurface {
  page_url: string;
  selector: string | null;
  recommended_tests: string[];
  owasp: string[];
}

export interface ApiSurface {
  /** Derived from URL parameters on pages (no network monitoring yet) */
  page_url: string;
  parameters: Array<{ name: string; in: string; applicable_attacks: string[] }>;
}

export interface EntryPoint {
  url: string;
  page_type: string;
  component_types: string[];
}

export interface AttackSurfaceModel {
  entry_points: EntryPoint[];
  auth_surfaces: AuthSurface[];
  data_input_surfaces: DataInputSurface[];
  file_upload_surfaces: FileUploadSurface[];
  admin_surfaces: AdminSurface[];
  api_surfaces: ApiSurface[];
}

/* ------------------------------------------------------------------ */
/*  Sub-types: SecurityTestingContext                                   */
/* ------------------------------------------------------------------ */

export interface TestCategory {
  id: string;
  label: string;
  attack_ids: string[];
  evidence_count: number;
  /** URLs of pages that triggered this category */
  source_pages: string[];
}

export interface PriorityTarget {
  page_url: string;
  component_type: string;
  selector: string | null;
  risk_level: RiskLevel;
  attack_ids: string[];
  reason: string;
}

export interface CandidateFlow {
  flow_id: string;
  description: string;
  start_url: string;
  steps: string[];
  covers_attack_ids: string[];
}

export interface SecurityTestingContext {
  recommended_test_categories: TestCategory[];
  priority_targets: PriorityTarget[];
  candidate_playwright_flows: CandidateFlow[];
}

/* ------------------------------------------------------------------ */
/*  Public composite type                                               */
/* ------------------------------------------------------------------ */

export interface SecurityModels {
  application_model: ApplicationModel;
  attack_surface_model: AttackSurfaceModel;
  security_testing_context: SecurityTestingContext;
}

/* ================================================================== */
/*  Builder                                                             */
/* ================================================================== */

/**
 * Build all three security models from discovered pages + graph edges.
 * Pure function — no side effects, no I/O.
 */
export function buildSecurityModels(
  pages: DiscoveredPage[],
  edges: CrawlEdge[],
): SecurityModels {
  const appModel = buildApplicationModel(pages, edges);
  const surfaceModel = buildAttackSurfaceModel(pages);
  const stc = buildSecurityTestingContext(pages, surfaceModel);

  return {
    application_model: appModel,
    attack_surface_model: surfaceModel,
    security_testing_context: stc,
  };
}

/* ------------------------------------------------------------------ */
/*  Application Model                                                   */
/* ------------------------------------------------------------------ */

function buildApplicationModel(pages: DiscoveredPage[], edges: CrawlEdge[]): ApplicationModel {
  // Deduplicate routes by url_path
  const routeMap = new Map<string, AppRoute>();
  for (const page of pages) {
    if (!routeMap.has(page.url_path)) {
      routeMap.set(page.url_path, {
        path: page.url_path,
        url: page.url,
        page_type: page.page_type,
        authentication_required: page.authentication_required,
      });
    }
  }

  // Flatten forms across all pages
  const forms: AppForm[] = [];
  for (const page of pages) {
    for (const form of page.forms) {
      const highRelevanceInputs = form.inputs
        .filter((i) => i.security_relevance === 'high')
        .map((i) => i.selector);

      forms.push({
        form_id: form.form_id,
        page_url: page.url,
        action: form.action,
        method: form.method,
        input_count: form.inputs.length,
        has_csrf_token: form.csrf_token.present,
        high_relevance_inputs: highRelevanceInputs,
      });
    }
  }

  // Navigation graph from crawler edges
  const navigationGraph: NavEdge[] = edges.map((e) => ({
    from: e.from,
    to: e.to,
    trigger_text: e.trigger_text,
  }));

  return {
    routes: Array.from(routeMap.values()),
    forms,
    navigation_graph: navigationGraph,
  };
}

/* ------------------------------------------------------------------ */
/*  Attack Surface Model                                                */
/* ------------------------------------------------------------------ */

/** Component types that map to auth surfaces */
const AUTH_COMPONENT_TYPES = new Set([
  'login_form',
  'admin_login_form',
  'registration_form',
  'password_recovery',
  'password_change_form',
  'password_field',
]);

/** Component types that are admin surfaces */
const ADMIN_COMPONENT_TYPES = new Set(['admin_function']);

/** Component types that are file surfaces */
const FILE_COMPONENT_TYPES = new Set(['file_upload', 'file_download']);

/** Component types that represent generic data input */
const DATA_INPUT_COMPONENT_TYPES = new Set([
  'search_box',
  'comment_form',
  'profile_form',
  'generic_form',
  'payment_form',
  'form_without_csrf',
  'csrf_protected_form',
]);

function riskForComponent(comp: SecurityComponent): RiskLevel {
  const highRisk = new Set([
    'login_form',
    'admin_login_form',
    'password_change_form',
    'admin_function',
    'file_upload',
    'payment_form',
    'form_without_csrf',
  ]);
  const mediumRisk = new Set([
    'registration_form',
    'search_box',
    'comment_form',
    'profile_form',
    'password_recovery',
    'csrf_protected_form',
    'password_field',
  ]);
  if (highRisk.has(comp.type)) return 'high';
  if (mediumRisk.has(comp.type)) return 'medium';
  return 'low';
}

function buildAttackSurfaceModel(pages: DiscoveredPage[]): AttackSurfaceModel {
  const entryPoints: EntryPoint[] = [];
  const authSurfaces: AuthSurface[] = [];
  const dataInputSurfaces: DataInputSurface[] = [];
  const fileUploadSurfaces: FileUploadSurface[] = [];
  const adminSurfaces: AdminSurface[] = [];
  const apiSurfaces: ApiSurface[] = [];

  for (const page of pages) {
    // Entry points: any page with at least one security component
    if (page.security_components.length > 0) {
      entryPoints.push({
        url: page.url,
        page_type: page.page_type,
        component_types: uniq(page.security_components.map((c) => c.type)),
      });
    }

    // API surfaces: pages with meaningful URL parameters
    const paramSurface = page.url_parameters.filter(
      (p) => p.applicable_attacks.length > 0 && p.name !== '__fragment__',
    );
    if (paramSurface.length > 0) {
      apiSurfaces.push({
        page_url: page.url,
        parameters: paramSurface.map((p) => ({
          name: p.name,
          in: p.in,
          applicable_attacks: p.applicable_attacks,
        })),
      });
    }

    // Per-component classification
    for (const comp of page.security_components) {
      if (AUTH_COMPONENT_TYPES.has(comp.type)) {
        authSurfaces.push({
          type: comp.type,
          page_url: page.url,
          selector: comp.selector,
          risk_level: riskForComponent(comp),
          recommended_tests: comp.applicable_attacks,
          owasp: comp.owasp ?? [],
        });
      } else if (ADMIN_COMPONENT_TYPES.has(comp.type)) {
        adminSurfaces.push({
          page_url: page.url,
          selector: comp.selector,
          recommended_tests: comp.applicable_attacks,
          owasp: comp.owasp ?? [],
        });
      } else if (FILE_COMPONENT_TYPES.has(comp.type)) {
        fileUploadSurfaces.push({
          page_url: page.url,
          selector: comp.selector,
          recommended_tests: comp.applicable_attacks,
        });
      } else if (DATA_INPUT_COMPONENT_TYPES.has(comp.type)) {
        // Collect semantic_types from inputs on this page to enrich the surface
        const semanticTypes = uniq(
          page.inputs
            .map((i) => i.semantic_type)
            .concat(page.forms.flatMap((f) => f.inputs.map((i) => i.semantic_type)))
            .filter((t) => t !== 'unknown'),
        );

        dataInputSurfaces.push({
          type: comp.type,
          page_url: page.url,
          selector: comp.selector,
          semantic_types: semanticTypes,
          risk_level: riskForComponent(comp),
          recommended_tests: comp.applicable_attacks,
        });
      }
    }
  }

  return {
    entry_points: entryPoints,
    auth_surfaces: authSurfaces,
    data_input_surfaces: dataInputSurfaces,
    file_upload_surfaces: fileUploadSurfaces,
    admin_surfaces: adminSurfaces,
    api_surfaces: apiSurfaces,
  };
}

/* ------------------------------------------------------------------ */
/*  Security Testing Context                                            */
/* ------------------------------------------------------------------ */

/** Maps attack_id → human-readable test category label */
const ATTACK_CATEGORY_LABELS: Record<string, string> = {
  sql_injection: 'SQL Injection',
  nosql_injection: 'NoSQL Injection',
  xss_reflected: 'Reflected XSS',
  xss_stored: 'Stored XSS',
  xss_dom: 'DOM-based XSS',
  csrf: 'Cross-Site Request Forgery',
  broken_auth: 'Broken Authentication',
  rate_limit: 'Rate Limiting / Brute Force',
  session_fixation: 'Session Fixation',
  session_cookie_flags: 'Insecure Session Cookies',
  sensitive_data_in_url: 'Sensitive Data in URL',
  default_credentials: 'Default Credentials',
  weak_password_policy: 'Weak Password Policy',
  idor: 'Insecure Direct Object Reference (IDOR)',
  path_traversal: 'Path Traversal',
  command_injection: 'Command Injection',
  ssti: 'Server-Side Template Injection',
  open_redirect: 'Open Redirect',
  ssrf: 'Server-Side Request Forgery',
  mixed_content: 'Mixed Content',
  security_headers_missing: 'Missing Security Headers',
  stack_trace_leak: 'Error/Stack Trace Disclosure',
};

function buildSecurityTestingContext(
  pages: DiscoveredPage[],
  surfaceModel: AttackSurfaceModel,
): SecurityTestingContext {
  // ── Recommended test categories ──────────────────────────────────
  // Aggregate all attack_ids across all surfaces, count evidence
  const categoryMap = new Map<string, { pages: Set<string>; attackIds: string[] }>();

  const allSurfaces: Array<{ page_url: string; recommended_tests: string[] }> = [
    ...surfaceModel.auth_surfaces,
    ...surfaceModel.data_input_surfaces,
    ...surfaceModel.file_upload_surfaces,
    ...surfaceModel.admin_surfaces,
  ];

  for (const surface of allSurfaces) {
    for (const attackId of surface.recommended_tests) {
      if (!categoryMap.has(attackId)) {
        categoryMap.set(attackId, { pages: new Set(), attackIds: [attackId] });
      }
      categoryMap.get(attackId)!.pages.add(surface.page_url);
    }
  }

  // Also include API parameter attacks
  for (const api of surfaceModel.api_surfaces) {
    for (const param of api.parameters) {
      for (const attackId of param.applicable_attacks) {
        if (!categoryMap.has(attackId)) {
          categoryMap.set(attackId, { pages: new Set(), attackIds: [attackId] });
        }
        categoryMap.get(attackId)!.pages.add(api.page_url);
      }
    }
  }

  const testCategories: TestCategory[] = Array.from(categoryMap.entries())
    .map(([id, data]) => ({
      id,
      label: ATTACK_CATEGORY_LABELS[id] ?? id,
      attack_ids: data.attackIds,
      evidence_count: data.pages.size,
      source_pages: Array.from(data.pages),
    }))
    .sort((a, b) => b.evidence_count - a.evidence_count);

  // ── Priority targets ──────────────────────────────────────────────
  // High-risk surfaces sorted by risk, then by attack coverage
  const priorityTargets: PriorityTarget[] = [];

  for (const auth of surfaceModel.auth_surfaces) {
    if (auth.risk_level === 'high' || auth.risk_level === 'critical') {
      priorityTargets.push({
        page_url: auth.page_url,
        component_type: auth.type,
        selector: auth.selector,
        risk_level: auth.risk_level,
        attack_ids: auth.recommended_tests,
        reason: `Auth surface (${auth.type}) — primary target for broken authentication and injection`,
      });
    }
  }

  for (const admin of surfaceModel.admin_surfaces) {
    priorityTargets.push({
      page_url: admin.page_url,
      component_type: 'admin_function',
      selector: admin.selector,
      risk_level: 'high',
      attack_ids: admin.recommended_tests,
      reason: 'Admin surface — test for broken access control and privilege escalation',
    });
  }

  for (const file of surfaceModel.file_upload_surfaces) {
    priorityTargets.push({
      page_url: file.page_url,
      component_type: 'file_upload',
      selector: file.selector,
      risk_level: 'high',
      attack_ids: file.recommended_tests,
      reason: 'File upload surface — test for unrestricted file upload and path traversal',
    });
  }

  for (const data of surfaceModel.data_input_surfaces) {
    if (data.risk_level === 'high') {
      priorityTargets.push({
        page_url: data.page_url,
        component_type: data.type,
        selector: data.selector,
        risk_level: data.risk_level,
        attack_ids: data.recommended_tests,
        reason: `Data input surface (${data.type}) — test for injection and XSS`,
      });
    }
  }

  // ── Candidate Playwright flows ────────────────────────────────────
  const flows: CandidateFlow[] = [];

  // Login flow (if auth surface exists)
  const loginSurface = surfaceModel.auth_surfaces.find((a) =>
    a.type === 'login_form' || a.type === 'admin_login_form',
  );
  if (loginSurface) {
    flows.push({
      flow_id: 'flow_login_brute_force',
      description: 'Attempt login with invalid credentials and verify rate limiting / lockout',
      start_url: loginSurface.page_url,
      steps: [
        `Navigate to ${loginSurface.page_url}`,
        'Fill username/email with valid test account',
        'Fill password with wrong value repeatedly',
        'Assert: account lockout or rate-limit response after N attempts',
        'Assert: no stack trace or verbose error leaked',
      ],
      covers_attack_ids: ['broken_auth', 'rate_limit', 'default_credentials'],
    });

    flows.push({
      flow_id: 'flow_login_sqli',
      description: 'Inject SQL payloads into login fields and verify no bypass or error leak',
      start_url: loginSurface.page_url,
      steps: [
        `Navigate to ${loginSurface.page_url}`,
        "Fill username with SQL payload (e.g. `' OR '1'='1`)",
        'Fill password with any value',
        'Submit form',
        'Assert: login is rejected, no 500 error, no SQL error in response',
      ],
      covers_attack_ids: ['sql_injection', 'stack_trace_leak'],
    });
  }

  // Registration flow (if present)
  const regSurface = surfaceModel.auth_surfaces.find((a) => a.type === 'registration_form');
  if (regSurface) {
    flows.push({
      flow_id: 'flow_registration_weak_password',
      description: 'Register with a weak password and verify policy enforcement',
      start_url: regSurface.page_url,
      steps: [
        `Navigate to ${regSurface.page_url}`,
        'Fill email with unique test address',
        'Fill password with weak value (e.g. `123456`, `password`)',
        'Submit form',
        'Assert: weak password is rejected with clear error message',
      ],
      covers_attack_ids: ['weak_password_policy'],
    });
  }

  // Search / XSS flow (if search box found)
  const searchSurface = surfaceModel.data_input_surfaces.find((d) => d.type === 'search_box');
  if (searchSurface) {
    flows.push({
      flow_id: 'flow_search_xss',
      description: 'Inject XSS payload into search box and verify no script execution',
      start_url: searchSurface.page_url,
      steps: [
        `Navigate to ${searchSurface.page_url}`,
        'Enter XSS payload into search input (e.g. `<script>alert(1)</script>`)',
        'Submit search',
        'Assert: payload is escaped/sanitized in the response, no alert fired',
      ],
      covers_attack_ids: ['xss_reflected', 'xss_dom'],
    });
  }

  // CSRF flow (if form_without_csrf found)
  const csrfSurface = surfaceModel.data_input_surfaces.find((d) => d.type === 'form_without_csrf');
  if (csrfSurface) {
    flows.push({
      flow_id: 'flow_csrf_state_change',
      description: 'Verify that state-changing POST forms include CSRF protection',
      start_url: csrfSurface.page_url,
      steps: [
        `Navigate to ${csrfSurface.page_url}`,
        'Identify POST form without detectable CSRF token',
        'Craft cross-origin POST request to the same form action',
        'Assert: server rejects or ignores the cross-origin request',
      ],
      covers_attack_ids: ['csrf'],
    });
  }

  // File upload flow
  const fileSurface = surfaceModel.file_upload_surfaces[0];
  if (fileSurface) {
    flows.push({
      flow_id: 'flow_file_upload_malicious',
      description: 'Upload disallowed file types and verify server-side validation',
      start_url: fileSurface.page_url,
      steps: [
        `Navigate to ${fileSurface.page_url}`,
        'Attempt to upload file with dangerous extension (.php, .exe, .html)',
        'Submit form',
        'Assert: server rejects the file or stores it with safe extension',
        'Assert: uploaded file is not directly executable via URL',
      ],
      covers_attack_ids: ['xss_stored', 'command_injection', 'path_traversal'],
    });
  }

  return {
    recommended_test_categories: testCategories,
    priority_targets: priorityTargets,
    candidate_playwright_flows: flows,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
