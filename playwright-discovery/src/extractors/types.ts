/**
 * Types for extracted page content.
 *
 * `Raw*` shapes are returned by the browser-side extraction (no selectors yet,
 * just DOM facts). The Node-side transformer enriches them into `Extracted*`
 * shapes with stable Playwright selectors.
 */

import type { ElementInfo } from '../selectors/types.js';

/* -------------------------------- Raw -------------------------------- */

export interface RawFormSnapshot {
  info: ElementInfo;
  action: string | null;
  method: string;
  enctype: string | null;
  /**
   * Full input snapshots (same metadata as standalone inputs).
   * Phase 1.2 fix: was previously ElementInfo[] which dropped required/pattern/etc.
   */
  inputs: RawInputSnapshot[];
  submitButton: ElementInfo | null;
  hasCsrfToken: boolean;
  csrfFieldName: string | null;
}

export interface RawButtonSnapshot {
  info: ElementInfo;
  buttonType: string; // submit | button | reset | link-button
  inForm: boolean;
}

export interface RawLinkSnapshot {
  info: ElementInfo;
  href: string;
  isExternal: boolean;
}

export interface RawNavSnapshot {
  section: 'navbar' | 'sidebar' | 'footer' | 'breadcrumb';
  items: Array<{ info: ElementInfo; href: string | null }>;
}

export interface RawTableSnapshot {
  info: ElementInfo;
  columns: string[];
  rowCount: number;
}

export interface RawInputSnapshot {
  info: ElementInfo;
  required: boolean;
  defaultValue: string | null;
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
  autocomplete: string | null;
}

export interface RawPageSnapshot {
  url: string;
  title: string;
  language: string;
  forms: RawFormSnapshot[];
  buttons: RawButtonSnapshot[];
  links: RawLinkSnapshot[];
  inputsOutsideForms: RawInputSnapshot[];
  navigation: RawNavSnapshot[];
  tables: RawTableSnapshot[];
  /** All href values seen on the page (resolved absolute, deduped). */
  linkUrls: string[];
}

/* ----------------------------- Extracted ----------------------------- */

/**
 * Selector confidence level, derived from Playwright verification results.
 *
 *   high   — verified, exactly 1 match (unique)
 *   medium — verified, but >1 elements matched
 *   low    — not verified (no Playwright check was performed, or fallback css-path)
 */
export type SelectorConfidence = 'high' | 'medium' | 'low';

export interface SelectorBundle {
  selector: string;
  playwright_locator: string;
  alternate_locators: string[];
  /**
   * Phase 2: selector verification metadata.
   * Present after extractPage() runs the verification pass.
   * `selector_verified: false` when verification was skipped or failed.
   */
  selector_verified: boolean;
  selector_unique: boolean;
  selector_match_count: number;
  selector_confidence: SelectorConfidence;
}

export interface ExtractedInput extends SelectorBundle {
  tag: string;
  name: string | null;
  id: string | null;
  type: string | null;
  label: string | null;
  placeholder: string | null;
  required: boolean;
  autocomplete: string | null;
  pattern: string | null;
  min_length: number | null;
  max_length: number | null;
  default_value: string | null;
  aria_label: string | null;
  data_testid: string | null;
  /**
   * Phase 3: semantic security classification.
   * Populated by classifyInput() in the transformer.
   */
  semantic_type: import('../classifier/semantic-input-classifier.js').SemanticType;
  data_category: import('../classifier/semantic-input-classifier.js').DataCategory;
  security_relevance: import('../classifier/semantic-input-classifier.js').SecurityRelevance;
}

export interface ExtractedButton extends SelectorBundle {
  text: string | null;
  type: string;
  aria_label: string | null;
  data_testid: string | null;
  inside_form: boolean;
}

export interface ExtractedLink extends SelectorBundle {
  text: string | null;
  href: string;
  is_external: boolean;
}

export interface ExtractedForm extends SelectorBundle {
  form_id: string;
  action: string | null;
  method: string;
  enctype: string | null;
  inputs: ExtractedInput[];
  submit: ExtractedButton | null;
  csrf_token: { present: boolean; field_name: string | null };
}

export interface ExtractedNavigation {
  navbar: ExtractedLink[];
  sidebar: ExtractedLink[];
  footer: ExtractedLink[];
  breadcrumb: ExtractedLink[];
}

export interface ExtractedTable extends SelectorBundle {
  name: string | null;
  columns: string[];
  row_count: number;
}
