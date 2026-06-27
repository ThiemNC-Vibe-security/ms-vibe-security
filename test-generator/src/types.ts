/**
 * Shared types across the pipeline.
 *
 * Three classes of types live here:
 *   1. Pipeline data — what flows through the stages.
 *   2. External shapes — slim mirrors of inputs (discovery JSON, knowledge YAML).
 *   3. Run-level structures — TestPlan, TestArtifact, the final output.
 */

/* --------------------------- Common --------------------------- */

export type Priority = 'high' | 'medium' | 'low';

/* ------------------- Discovery (slim mirror) ------------------- */
/**
 * Mirrors the shape produced by playwright-discovery. We don't import its
 * types directly because the two projects are independent — looser coupling
 * is intentional. Only the fields we consume are typed.
 */

export interface SelectorBundle {
  selector: string;
  playwright_locator: string;
  alternate_locators: string[];
}

export interface DiscoveryInput extends SelectorBundle {
  tag: string;
  name: string | null;
  id: string | null;
  type: string | null;
  label: string | null;
  placeholder: string | null;
  required: boolean;
  aria_label: string | null;
  data_testid: string | null;
}

export interface DiscoveryButton extends SelectorBundle {
  text: string | null;
  type: string;
  inside_form: boolean;
}

export interface DiscoveryForm extends SelectorBundle {
  form_id: string;
  action: string | null;
  method: string;
  inputs: DiscoveryInput[];
  submit: DiscoveryButton | null;
  csrf_token: { present: boolean; field_name: string | null };
}

export interface DiscoverySecurityComponent {
  type: string;
  selector: string;
  applicable_attacks: string[];
  owasp: string[];
  description?: string;
}

export interface DiscoveryUrlParameter {
  name: string;
  value: string;
  in: 'query' | 'path' | 'fragment';
  applicable_attacks: string[];
}

export interface DiscoveryPage {
  url: string;
  url_path: string;
  title: string;
  page_type: string;
  language: string;
  authentication_required: boolean;
  http_status: number;
  forms: DiscoveryForm[];
  buttons: DiscoveryButton[];
  inputs: DiscoveryInput[];
  links: Array<SelectorBundle & { text: string | null; href: string; is_external: boolean }>;
  security_components: DiscoverySecurityComponent[];
  url_parameters: DiscoveryUrlParameter[];
  next_candidate_pages: string[];
}

export interface DiscoveryFile {
  metadata: {
    base_url: string;
    discovered_at: string;
    duration_seconds: number;
    user_agent: string;
    config_hash: string;
  };
  stats: Record<string, number>;
  pages: DiscoveryPage[];
  graph: { edges: unknown[] };
  errors: unknown[];
}

/* ----------------------- Summary (compressed) ----------------------- */
/**
 * Compact view fed to the Planner LLM. ~10% the size of DiscoveryFile.
 * Contains stable IDs the planner can refer to.
 */

export interface SummaryInput {
  input_id: string;
  name: string | null;
  type: string | null;
  label: string | null;
  required: boolean;
  aria_label: string | null;
}

export interface SummaryForm {
  form_id: string;          // matches DiscoveryForm.form_id
  method: string;
  action: string | null;
  has_csrf: boolean;
  inputs: SummaryInput[];
  submit_text: string | null;
}

export interface SummarySecurityComponent {
  type: string;
  selector_ref: string;     // form_id or input_id this targets
  applicable_attacks: string[];
}

export interface SummaryPage {
  page_id: string;          // generated, e.g. "P-001"
  url: string;
  page_type: string;
  authentication_required: boolean;
  forms: SummaryForm[];
  standalone_inputs: SummaryInput[];
  security_components: SummarySecurityComponent[];
  url_parameters: Array<{ name: string; in: string; applicable_attacks: string[] }>;
}

export interface DiscoverySummary {
  base_url: string;
  pages: SummaryPage[];
}

/* ----------------------- Tester Requirement ----------------------- */

export interface TesterRequirement {
  target_discovery: string;
  scope: {
    include_page_types: string[];
    exclude_pages: string[];
    include_urls: string[];
  };
  priorities: {
    high: string[];
    medium: string[];
    low: string[];
  };
  limits: {
    max_tests: number;
    max_tests_per_page: number;
  };
  test_config: {
    browsers: string[];
    parallel: number;
    base_url?: string;
  };
  credentials: {
    valid: { user: string; pass: string } | null;
    invalid: { user: string; pass: string } | null;
  };
}

/* ----------------------- Knowledge (attacks) ----------------------- */

export interface KnowledgeAttack {
  id: string;                       // e.g. "sql_injection"
  name: string;
  owasp: string[];                  // e.g. ["A05:2025", "A03:2021"]
  cwe: string[];                    // e.g. ["CWE-89"]
  asvs: string[];                   // ASVS v5.0 requirement IDs, e.g. ["V5.3.4"]
  applies_to: string[];             // component types (login_form, search_box, etc.)
  payloads: string[];
  detection: string[];              // detection rule IDs
  test_template_hints: string[];
  description?: string;
}

export interface KnowledgeBase {
  attacks: KnowledgeAttack[];
  /** Index by attack id. */
  byId: Map<string, KnowledgeAttack>;
}

/* ----------------------- TestPlan / TestCase ----------------------- */

export interface TestCaseTarget {
  page_id: string;
  page_url: string;
  form_id?: string;
  input_id?: string;
  url_parameter?: string;
}

export interface TestCase {
  id: string;                       // e.g. "TC-001"
  target: TestCaseTarget;
  attack_id: string;                // matches KnowledgeAttack.id
  attack_class: string;             // human-readable category
  priority: Priority;
  why: string;                      // 1-line rationale from planner
  hints?: string[];
}

export interface TestPlan {
  metadata: {
    discovery_source: string;
    generated_at: string;
    planner_model: string;
    pages_considered: number;
    test_count: number;
  };
  test_cases: TestCase[];
}

/* ----------------------- TestArtifact ----------------------- */

export interface TestArtifact {
  test_case_id: string;
  page_id: string;
  page_url: string;
  attack_id: string;
  filename: string;
  code: string;
  /** True if Gemini returned something usable; false if we recorded a fallback / stub. */
  generated_ok: boolean;
  error?: string;
}

/* ----------------------- Final output ----------------------- */

export interface GenerationOutput {
  metadata: {
    discovery_source: string;
    tester_source: string;
    generated_at: string;
    duration_seconds: number;
    model: string;
  };
  stats: {
    test_cases_planned: number;
    tests_generated: number;
    tests_failed: number;
    spec_files_written: number;
  };
  plan: TestPlan;
  artifacts: TestArtifact[];
}
