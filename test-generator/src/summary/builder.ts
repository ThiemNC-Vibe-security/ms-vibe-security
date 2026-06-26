/**
 * Discovery Summary Builder
 *
 * Compresses a full DiscoveryFile into a DiscoverySummary suitable for the
 * Planner LLM. Drops verbose fields and assigns stable IDs (page_id, input_id)
 * the planner can refer to without ambiguity.
 *
 * The Node-side generator later uses these IDs to look up the full element
 * detail when building the per-test prompt.
 */

import type {
  DiscoveryFile,
  DiscoveryPage,
  DiscoveryInput,
  DiscoverySummary,
  SummaryPage,
  SummaryForm,
  SummaryInput,
} from '../types.js';

export interface SummaryIndex {
  /** page_id → full DiscoveryPage */
  pages: Map<string, DiscoveryPage>;
  /** "page_id/form_id" → full form */
  forms: Map<string, DiscoveryPage['forms'][number]>;
  /** "page_id/input_id" → full input (in or out of form) */
  inputs: Map<string, DiscoveryInput>;
}

export interface SummaryBuildResult {
  summary: DiscoverySummary;
  index: SummaryIndex;
}

export function buildSummary(discovery: DiscoveryFile): SummaryBuildResult {
  const pages: SummaryPage[] = [];
  const index: SummaryIndex = {
    pages: new Map(),
    forms: new Map(),
    inputs: new Map(),
  };

  discovery.pages.forEach((page, pageIdx) => {
    const pageId = `P-${String(pageIdx + 1).padStart(3, '0')}`;
    index.pages.set(pageId, page);

    const forms: SummaryForm[] = page.forms.map((form, formIdx) => {
      const formId = form.form_id || `F-${String(formIdx + 1).padStart(3, '0')}`;
      index.forms.set(`${pageId}/${formId}`, form);

      const inputs: SummaryInput[] = form.inputs.map((input, inputIdx) => {
        const inputId =
          input.data_testid ||
          input.name ||
          input.id ||
          `IN-${String(inputIdx + 1).padStart(3, '0')}`;
        index.inputs.set(`${pageId}/${inputId}`, input);
        return summarizeInput(input, inputId);
      });

      return {
        form_id: formId,
        method: form.method,
        action: form.action,
        has_csrf: form.csrf_token.present,
        inputs,
        submit_text: form.submit?.text ?? null,
      };
    });

    const standaloneInputs: SummaryInput[] = page.inputs.map((input, idx) => {
      const inputId =
        input.data_testid || input.name || input.id || `SI-${String(idx + 1).padStart(3, '0')}`;
      index.inputs.set(`${pageId}/${inputId}`, input);
      return summarizeInput(input, inputId);
    });

    pages.push({
      page_id: pageId,
      url: page.url,
      page_type: page.page_type,
      authentication_required: page.authentication_required,
      forms,
      standalone_inputs: standaloneInputs,
      security_components: page.security_components.map((sc) => ({
        type: sc.type,
        // selector_ref is best-effort: matches a form/input selector or "page"
        selector_ref: resolveSelectorRef(sc.selector, page),
        applicable_attacks: sc.applicable_attacks,
      })),
      url_parameters: page.url_parameters.map((p) => ({
        name: p.name,
        in: p.in,
        applicable_attacks: p.applicable_attacks,
      })),
    });
  });

  const summary: DiscoverySummary = {
    base_url: discovery.metadata.base_url,
    pages,
  };

  return { summary, index };
}

function summarizeInput(input: DiscoveryInput, inputId: string): SummaryInput {
  return {
    input_id: inputId,
    name: input.name,
    type: input.type,
    label: input.label,
    required: input.required,
    aria_label: input.aria_label,
  };
}

/**
 * Map a security_component.selector back to a form_id or input_id when possible.
 * Falls back to the literal selector or 'page' when nothing matches.
 */
function resolveSelectorRef(selector: string, page: DiscoveryPage): string {
  for (const form of page.forms) {
    if (form.selector === selector) return form.form_id;
    for (const input of form.inputs) {
      if (input.selector === selector) {
        return `${form.form_id}/${input.name ?? input.id ?? 'input'}`;
      }
    }
  }
  for (const input of page.inputs) {
    if (input.selector === selector) {
      return input.name ?? input.id ?? 'standalone_input';
    }
  }
  return selector;
}
