/**
 * Per-test-case prompt for the Generator.
 *
 * Returns ONE Playwright test in TypeScript. The prompt makes it explicit that
 * the LLM must reuse the literal Playwright locators provided in the context —
 * never invent selectors.
 */

import type { GeneratorContext } from './context.js';

export function buildGeneratorPrompt(ctx: GeneratorContext): string {
  const tcId = ctx.test_case.id;
  return `You are a senior Playwright security test engineer. Generate ONE Playwright test in TypeScript for the test case below.

================ TEST CASE ================
${JSON.stringify(ctx.test_case, null, 2)}

================ TARGET PAGE ================
${JSON.stringify(ctx.page, null, 2)}

================ ATTACK DEFINITION ================
${JSON.stringify(ctx.attack, null, 2)}

================ TEST CONFIG ================
${JSON.stringify(ctx.test_config, null, 2)}

================ STRICT RULES ================
1. Output TypeScript code ONLY. No markdown, no code fences, no explanations.
2. Use \`import { test, expect } from '@playwright/test';\` at the top.
3. Use ONLY the Playwright locators provided in TARGET PAGE. Do not invent selectors.
   - Prefer the \`playwright_locator\` field over \`selector\`.
   - The \`alternate_locators\` are alternatives; pick whichever is clearest.
4. The test name should reference the attack class and target, e.g.
   "${tcId} - ${ctx.attack.name} on <target>".
5. Navigate to TEST CONFIG.base_url + page.url (handle absolute URLs gracefully).
6. Apply the attack:
   - For form-targeted tests: fill the target input with each payload, submit the form, observe the response.
   - For input-targeted tests: target just that input; fill remaining required fields with safe dummy values that match their type/label.
   - For url_parameter tests: navigate with the payload substituted.
7. Use the attack's \`test_template_hints\` to shape the test body. Apply detection rules from \`detection\`.
8. Assertions must be concrete and use Playwright's expect API. Examples:
   - await expect(page).not.toHaveURL(/external\\.com/)
   - await expect(page.locator('text=Error')).not.toContainText(/sql|syntax/i)
   - await expect(response.status()).toBe(...)
9. If the test_config.credentials.valid is set and the page is a login page,
   you may use those credentials as the username while injecting payloads into the password (or vice versa) depending on attack semantics.
10. Wrap the test in a single test() call. Do not produce describe blocks or fixtures.
11. Keep test runtime under 30 seconds. Add reasonable timeouts.
12. If the attack has no payloads (e.g. csrf, rate_limit), follow its test_template_hints exactly.

Return the TypeScript code now. Just the code.`;
}
