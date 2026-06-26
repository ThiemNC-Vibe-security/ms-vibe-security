/**
 * Generator context builder.
 *
 * For each TestCase, assembles a focused context object containing only
 * what the per-test prompt needs:
 *   - the full target page (or just the targeted form/input)
 *   - the matching attack definition with payloads
 *   - the test config (base_url, credentials)
 *
 * Keeps prompts small (2-5K tokens) instead of resending the whole discovery.
 */

import type { SummaryIndex } from '../summary/builder.js';
import type {
  DiscoveryForm,
  DiscoveryInput,
  DiscoveryPage,
  KnowledgeAttack,
  KnowledgeBase,
  TestCase,
  TesterRequirement,
} from '../types.js';

export interface GeneratorContext {
  test_case: TestCase;
  attack: KnowledgeAttack;
  page: PageContext;
  test_config: TestConfigContext;
}

export interface PageContext {
  page_id: string;
  url: string;
  page_type: string;
  authentication_required: boolean;
  /** Only populated when test_case.target.form_id is set. */
  target_form?: FormContext;
  /** Only populated when test_case.target.input_id is set. */
  target_input?: InputContext;
  /** Only the url_parameter mentioned in the test case (if any). */
  target_url_parameter?: { name: string; in: string };
  /** Always include other forms/inputs at a glance (in case LLM needs to assert against e.g. error messages). */
  page_forms_summary: Array<{ form_id: string; method: string; input_names: string[] }>;
}

export interface FormContext {
  form_id: string;
  selector: string;
  playwright_locator: string;
  alternate_locators: string[];
  action: string | null;
  method: string;
  has_csrf: boolean;
  inputs: InputContext[];
  submit: {
    selector: string;
    playwright_locator: string;
    text: string | null;
  } | null;
}

export interface InputContext {
  input_id: string;
  selector: string;
  playwright_locator: string;
  alternate_locators: string[];
  tag: string;
  name: string | null;
  type: string | null;
  label: string | null;
  placeholder: string | null;
  required: boolean;
}

export interface TestConfigContext {
  base_url: string;
  browsers: string[];
  credentials: {
    valid: { user: string; pass: string } | null;
    invalid: { user: string; pass: string } | null;
  };
}

/* ---------------------------- Builder ---------------------------- */

export function buildContext(
  testCase: TestCase,
  index: SummaryIndex,
  knowledge: KnowledgeBase,
  tester: TesterRequirement,
  baseUrl: string,
): GeneratorContext {
  const page = index.pages.get(testCase.target.page_id);
  if (!page) {
    throw new Error(`Page not found in index: ${testCase.target.page_id}`);
  }

  const attack = knowledge.byId.get(testCase.attack_id);
  if (!attack) {
    throw new Error(`Attack not found in knowledge: ${testCase.attack_id}`);
  }

  const ctx: GeneratorContext = {
    test_case: testCase,
    attack,
    page: buildPageContext(page, testCase, index),
    test_config: {
      base_url: tester.test_config.base_url ?? baseUrl,
      browsers: tester.test_config.browsers,
      credentials: tester.credentials,
    },
  };

  return ctx;
}

function buildPageContext(
  page: DiscoveryPage,
  testCase: TestCase,
  index: SummaryIndex,
): PageContext {
  const ctx: PageContext = {
    page_id: testCase.target.page_id,
    url: page.url,
    page_type: page.page_type,
    authentication_required: page.authentication_required,
    page_forms_summary: page.forms.map((f) => ({
      form_id: f.form_id,
      method: f.method,
      input_names: f.inputs.map((i) => i.name ?? i.id ?? '').filter(Boolean),
    })),
  };

  if (testCase.target.form_id) {
    const formKey = `${testCase.target.page_id}/${testCase.target.form_id}`;
    const form = index.forms.get(formKey);
    if (form) ctx.target_form = toFormContext(form);
  }

  if (testCase.target.input_id) {
    const inputKey = `${testCase.target.page_id}/${testCase.target.input_id}`;
    const input = index.inputs.get(inputKey);
    if (input) ctx.target_input = toInputContext(input, testCase.target.input_id);
  }

  if (testCase.target.url_parameter) {
    const param = page.url_parameters.find((p) => p.name === testCase.target.url_parameter);
    if (param) ctx.target_url_parameter = { name: param.name, in: param.in };
  }

  return ctx;
}

function toFormContext(form: DiscoveryForm): FormContext {
  return {
    form_id: form.form_id,
    selector: form.selector,
    playwright_locator: form.playwright_locator,
    alternate_locators: form.alternate_locators,
    action: form.action,
    method: form.method,
    has_csrf: form.csrf_token.present,
    inputs: form.inputs.map((i) => toInputContext(i, i.name ?? i.id ?? 'input')),
    submit: form.submit
      ? {
          selector: form.submit.selector,
          playwright_locator: form.submit.playwright_locator,
          text: form.submit.text,
        }
      : null,
  };
}

function toInputContext(input: DiscoveryInput, inputId: string): InputContext {
  return {
    input_id: inputId,
    selector: input.selector,
    playwright_locator: input.playwright_locator,
    alternate_locators: input.alternate_locators,
    tag: input.tag,
    name: input.name,
    type: input.type,
    label: input.label,
    placeholder: input.placeholder,
    required: input.required,
  };
}
