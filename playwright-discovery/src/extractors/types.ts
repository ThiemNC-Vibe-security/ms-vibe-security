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
  inputs: ElementInfo[];
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

export interface SelectorBundle {
  selector: string;
  playwright_locator: string;
  alternate_locators: string[];
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
