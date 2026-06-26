import { ApplicationModel } from '../models/discovery.model.js';

export function generatePrompt(discovery: ApplicationModel): string {
  const discoveryJson = JSON.stringify(discovery, null, 2);

  return `You are a senior QA automation engineer specializing in Playwright test automation.

I will provide you with a structured application model (JSON) that describes a website's pages, forms, navigation, buttons, and business actions.

Your task: Generate comprehensive Playwright TypeScript test scripts based on this data.

Application Model:

${discoveryJson}

Requirements:

1. Use the base_url from the model as BASE_URL constant: "${discovery.base_url}"
2. For each page that has forms, generate:
   - Happy Path Test (valid inputs, successful submission)
   - Invalid Input Test (wrong data types, invalid formats)
   - Empty Required Field Test (leave required fields empty)
3. For pages with navigation, generate navigation tests.
4. For pages with business actions, generate action verification tests.
5. Use Playwright Test framework with TypeScript.
6. Use proper selectors based on the input names, labels, and structure provided.
7. Group tests by page using test.describe().
8. Output TypeScript code ONLY. No markdown, no explanation, no code fences.`;
}
