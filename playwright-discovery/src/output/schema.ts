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

/* ----------------------------- Top-level ----------------------------- */

export interface DiscoveryOutput {
  metadata: DiscoveryMetadata;
  stats: DiscoveryStats;
  pages: DiscoveredPage[];
  graph: CrawlGraph;
  errors: DiscoveryError[];
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
