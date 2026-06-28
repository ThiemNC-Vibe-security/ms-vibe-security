/**
 * Output schema types for the discovery result.
 *
 * These types define the structure of the JSON file written at the end
 * of a discovery run.
 */

import type {
  ExtractedButton,
  ExtractedForm,
  ExtractedInput,
  ExtractedLink,
  ExtractedNavigation,
  ExtractedTable,
} from '../extractors/types.js';
import type { SecurityModels } from './model-builder.js';
import type { CapturedEndpoint, NetworkSummary } from '../probe/network-monitor.js';

/* ----------------------------- Top-level ----------------------------- */

export interface DiscoveryOutput extends SecurityModels {
  metadata: DiscoveryMetadata;
  stats: DiscoveryStats;
  pages: DiscoveredPage[];
  graph: CrawlGraph;
  errors: DiscoveryError[];
  /**
   * Phase 4 fields (application_model, attack_surface_model,
   * security_testing_context) are inherited from SecurityModels.
   */
  /** Phase 5: deduplicated API endpoints observed during crawl */
  endpoints: CapturedEndpoint[];
  /** Phase 5: high-level network capture statistics */
  network_summary: NetworkSummary;
  /** Phase 7: evaluation metrics for research reporting and regression detection */
  evaluation_metrics: EvaluationMetrics;
}

export interface DiscoveryMetadata {
  base_url: string;
  discovered_at: string;
  duration_seconds: number;
  playwright_version: string;
  user_agent: string;
  config_hash: string;
}

export interface DiscoveryStats {
  pages_discovered: number;
  pages_failed: number;
  total_forms: number;
  total_inputs: number;
  total_buttons: number;
  total_links: number;
  security_components: number;
}

/* ------------------------------ Pages ------------------------------ */

export interface DiscoveredPage {
  url: string;
  url_path: string;
  title: string;
  page_type: string;
  language: string;
  authentication_required: boolean;
  http_status: number;
  load_time_ms: number;

  navigation: ExtractedNavigation;
  forms: ExtractedForm[];
  buttons: ExtractedButton[];
  inputs: ExtractedInput[];
  tables: ExtractedTable[];
  links: ExtractedLink[];

  security_components: SecurityComponent[];
  url_parameters: UrlParameter[];

  next_candidate_pages: string[];
  screenshot_path: string | null;

  /**
   * Phase 6: dynamic UI components discovered via safe interaction.
   * Empty array when interact.enabled = false (default).
   */
  dynamic_components: DynamicComponent[];
  /** Phase 6: log of interactions performed on this page. */
  interactions_performed: InteractionRecord[];
}

/* ----------------------- Dynamic UI (Phase 6) ---------------------- */

export interface DynamicComponent {
  /** Component category: modal | tab_panel | dropdown | accordion | sidebar_panel | unknown */
  type: string;
  /** Selector of the trigger element that revealed this component */
  trigger_selector: string;
  /** Text of the trigger element */
  trigger_text: string | null;
  /** Title / heading text inside the revealed component (if detectable) */
  title: string | null;
  /** Forms discovered inside the component */
  forms: ExtractedForm[];
  /** Buttons discovered inside the component */
  buttons: ExtractedButton[];
  /** Inputs discovered inside the component */
  inputs: ExtractedInput[];
}

export interface InteractionRecord {
  action: 'click';
  selector: string;
  trigger_text: string | null;
  /** What was discovered as a result of this interaction */
  result: 'modal_opened' | 'panel_revealed' | 'dropdown_opened' | 'tab_activated' | 'no_change' | 'error';
  error?: string;
}

/* ------------------------- Security ----------------------------- */

export interface SecurityComponent {
  type: string;
  selector: string | null;
  applicable_attacks: string[];
  owasp?: string[];
  description?: string;
  confidence?: number;
  details?: Record<string, unknown>;
}

export interface UrlParameter {
  name: string;
  value: string;
  in: 'query' | 'path' | 'fragment';
  applicable_attacks: string[];
}

/* ------------------------------ Graph ------------------------------ */

export interface CrawlGraph {
  edges: CrawlEdge[];
}

export interface CrawlEdge {
  from: string;
  to: string;
  trigger_text: string | null;
  trigger_selector: string | null;
}

/* ------------------------------ Errors ----------------------------- */

export interface DiscoveryError {
  url: string;
  error_type: string;
  message: string;
  timestamp: string;
}

/* ---------------------- Evaluation Metrics (Phase 7) --------------- */

export interface EvaluationMetrics {
  /** Total pages successfully crawled */
  pages_discovered: number;
  /** Pages that failed to load / extract */
  crawl_errors: number;
  /** Unique forms found across all pages */
  forms_discovered: number;
  /** Total inputs (standalone + inside forms) */
  inputs_discovered: number;
  /** Total buttons */
  buttons_discovered: number;
  /** Total links */
  links_discovered: number;
  /** Deduplicated API endpoints captured (Phase 5) */
  endpoints_discovered: number;
  /** Total selectors across forms, inputs, buttons, links */
  selectors_total: number;
  /**
   * Selectors confirmed by Playwright locator.count() > 0 (Phase 2).
   * 0 if selector verification was not run (all selector_verified = false).
   */
  selectors_verified: number;
  /**
   * Fraction of verified selectors: selectors_verified / selectors_total.
   * null when selectors_total = 0.
   */
  selector_success_rate: number | null;
  /** Unique security component types detected across all pages */
  security_components_detected: number;
  /** Distinct attack surface items from the attack_surface_model (Phase 4) */
  attack_surface_count: number;
  /** Dynamic UI components found via Phase 6 interaction (0 when disabled) */
  dynamic_components_discovered: number;
}
