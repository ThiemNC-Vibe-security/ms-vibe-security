import { DiscoveryResult } from '../models/discovery.model.js';

export function generatePrompt(discovery: DiscoveryResult): string {
  const discoveryJson = JSON.stringify(discovery, null, 2);

  return `You are a senior QA automation engineer.

Generate Playwright TypeScript tests.

Application Information:

${discoveryJson}

Requirements:

1. Generate Happy Path Test.
2. Generate Invalid Input Test.
3. Generate Empty Required Field Test.
4. Use Playwright Test framework.
5. Output TypeScript only.
6. No markdown.`;
}
