/**
 * Node-side transformer.
 *
 * Takes the raw snapshot returned by browser-extract.ts and enriches every
 * element with stable Playwright selectors (via selectors/generator.ts).
 *
 * Each per-element helper is exported so it can be unit-tested independently.
 */

import { generateSelector } from '../selectors/generator.js';
import type { ElementInfo } from '../selectors/types.js';
import type {
  ExtractedButton,
  ExtractedForm,
  ExtractedInput,
  ExtractedLink,
  ExtractedNavigation,
  ExtractedTable,
  RawButtonSnapshot,
  RawFormSnapshot,
  RawInputSnapshot,
  RawLinkSnapshot,
  RawNavSnapshot,
  RawTableSnapshot,
} from './types.js';

function selectorOf(info: ElementInfo) {
  const result = generateSelector(info);
  return {
    selector: result.selector,
    playwright_locator: result.playwrightLocator,
    alternate_locators: result.alternates,
  };
}

/* --------------------------- form / input --------------------------- */

export function buildInput(info: ElementInfo, attrs?: Partial<RawInputSnapshot>): ExtractedInput {
  return {
    ...selectorOf(info),
    tag: info.tag,
    name: info.name,
    id: info.id,
    type: info.type,
    label: info.label,
    placeholder: info.placeholder,
    required: attrs?.required ?? false,
    autocomplete: attrs?.autocomplete ?? null,
    pattern: attrs?.pattern ?? null,
    min_length: attrs?.minLength ?? null,
    max_length: attrs?.maxLength ?? null,
    default_value: attrs?.defaultValue ?? null,
    aria_label: info.ariaLabel,
    data_testid: info.testId,
  };
}

export function buildButton(snap: RawButtonSnapshot): ExtractedButton {
  return {
    ...selectorOf(snap.info),
    text: snap.info.text,
    type: snap.buttonType,
    aria_label: snap.info.ariaLabel,
    data_testid: snap.info.testId,
    inside_form: snap.inForm,
  };
}

export function buildForms(snapshots: RawFormSnapshot[]): ExtractedForm[] {
  return snapshots.map((form, index) => {
    const submit: ExtractedButton | null = form.submitButton
      ? buildButton({ info: form.submitButton, buttonType: 'submit', inForm: true })
      : null;
    return {
      ...selectorOf(form.info),
      form_id: form.info.id || form.info.name || `form-${index}`,
      action: form.action,
      method: form.method,
      enctype: form.enctype,
      // Pass the full RawInputSnapshot so metadata (required, pattern, etc.) is preserved
      inputs: form.inputs.map((snap) => buildInput(snap.info, snap)),
      submit,
      csrf_token: {
        present: form.hasCsrfToken,
        field_name: form.csrfFieldName,
      },
    };
  });
}

export function buildButtons(snapshots: RawButtonSnapshot[]): ExtractedButton[] {
  return snapshots.map(buildButton);
}

export function buildStandaloneInputs(snapshots: RawInputSnapshot[]): ExtractedInput[] {
  return snapshots.map((s) => buildInput(s.info, s));
}

/* ------------------------------ links ------------------------------ */

export function buildLink(snap: RawLinkSnapshot): ExtractedLink {
  return {
    ...selectorOf(snap.info),
    text: snap.info.text,
    href: snap.href,
    is_external: snap.isExternal,
  };
}

export function buildLinks(snapshots: RawLinkSnapshot[]): ExtractedLink[] {
  return snapshots.map(buildLink);
}

/* --------------------------- navigation --------------------------- */

export function buildNavigation(snapshots: RawNavSnapshot[]): ExtractedNavigation {
  const out: ExtractedNavigation = {
    navbar: [],
    sidebar: [],
    footer: [],
    breadcrumb: [],
  };
  for (const region of snapshots) {
    const links = region.items.map((item) =>
      buildLink({
        info: item.info,
        href: item.href || '',
        isExternal: false,
      }),
    );
    out[region.section] = out[region.section].concat(links);
  }
  return out;
}

/* ----------------------------- tables ----------------------------- */

export function buildTable(snap: RawTableSnapshot): ExtractedTable {
  return {
    ...selectorOf(snap.info),
    name: snap.info.title || snap.info.ariaLabel || null,
    columns: snap.columns,
    row_count: snap.rowCount,
  };
}

export function buildTables(snapshots: RawTableSnapshot[]): ExtractedTable[] {
  return snapshots.map(buildTable);
}
