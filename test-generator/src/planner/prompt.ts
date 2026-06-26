/**
 * Planner prompt builder.
 *
 * The prompt is built deterministically from the compressed summary, the
 * tester requirement, and a *compact* index of knowledge (id + name +
 * applies_to only — payloads stay in the YAML for the Generator).
 */

import type {
  DiscoverySummary,
  KnowledgeBase,
  TesterRequirement,
} from '../types.js';

export interface KnowledgeIndexItem {
  id: string;
  name: string;
  owasp: string[];
  applies_to: string[];
}

export function buildKnowledgeIndex(kb: KnowledgeBase): KnowledgeIndexItem[] {
  return kb.attacks.map((a) => ({
    id: a.id,
    name: a.name,
    owasp: a.owasp,
    applies_to: a.applies_to,
  }));
}

/**
 * Compose the planner prompt. Everything is laid out as labelled JSON blocks
 * so the LLM doesn't have to parse free text.
 */
export function buildPlannerPrompt(
  summary: DiscoverySummary,
  tester: TesterRequirement,
  knowledgeIndex: KnowledgeIndexItem[],
): string {
  return `You are a senior security test planner. Your job: decide WHICH security tests should be generated for a target web application.

You are given three structured inputs:
  1. DISCOVERY SUMMARY — a compressed map of the application (pages, forms, inputs, security components).
  2. TESTER REQUIREMENT — priorities, scope filters, and limits chosen by the human tester.
  3. KNOWLEDGE INDEX — the catalogue of attack types available to choose from.

Produce a TEST PLAN: a list of test cases, each one referring to a specific page (page_id) and an attack type (attack_id). Do not invent IDs — use only the ones present in the inputs.

================ DISCOVERY SUMMARY ================
${JSON.stringify(summary, null, 2)}

================ TESTER REQUIREMENT ================
${JSON.stringify(tester, null, 2)}

================ KNOWLEDGE INDEX ================
${JSON.stringify(knowledgeIndex, null, 2)}

================ RULES ================
1. Pick attacks only from the KNOWLEDGE INDEX. Use the literal attack_id values.
2. Pick pages only from the DISCOVERY SUMMARY. Use the literal page_id values.
3. For each test case, the attack's applies_to must overlap with the page's security_components.type OR with the page's url_parameter applicable_attacks.
4. Respect tester scope:
   - If scope.include_page_types is non-empty, only target pages whose page_type is in it.
   - Skip any page whose url matches scope.exclude_pages (treat \`*\` as wildcard segment).
5. Respect tester priorities:
   - High > Medium > Low. Allocate the test budget high-first.
   - Attacks not in any priority list may still be included if leftover budget allows, but mark them as "low".
6. Respect limits:
   - Total test cases ≤ limits.max_tests.
   - Per-page test cases ≤ limits.max_tests_per_page.
7. Prefer breadth over depth. Don't repeat the same attack on the same form 3 times; one test per (page, form, attack) is enough.
8. Each test case must include a one-sentence "why" explaining the choice.
9. If a page has security_components but no matching priority attack, skip it instead of generating low-value tests.
10. If you cannot produce a plan (e.g. discovery is empty), return an empty test_cases array — do not invent.

================ OUTPUT FORMAT ================
Return ONLY a JSON object matching this shape (no markdown, no commentary):

{
  "test_cases": [
    {
      "id": "TC-001",
      "target": {
        "page_id": "P-001",
        "page_url": "<copy from summary>",
        "form_id": "<optional, when applicable>",
        "input_id": "<optional, when targeting a specific input>",
        "url_parameter": "<optional, when targeting a query param>"
      },
      "attack_id": "<from knowledge index>",
      "attack_class": "<knowledge name>",
      "priority": "high" | "medium" | "low",
      "why": "One sentence rationale."
    }
  ]
}

Generate the JSON now.`;
}
