import { ApplicationModel } from '../models/discovery.model.js';
import { readJsonFile, writeOutputFile } from '../utils/file.util.js';
import { logInfo, logSuccess, logError } from '../utils/logger.util.js';
import { generatePrompt } from './prompt.generator.js';
import { generatePlaywrightScript } from '../services/gemini.service.js';

const INPUT_PATH = 'input/discovery.json';
const OUTPUT_PATH = 'output/generated.spec.ts';

export async function generate(): Promise<void> {
  // Step 1: Load discovery file
  logInfo('Loading discovery file...');
  const discovery = await readJsonFile<ApplicationModel>(INPUT_PATH);
  logInfo(`Loaded application model: ${discovery.base_url} (${discovery.total_pages_discovered} pages)`);
  logSuccess('Discovery file loaded.');

  // Step 2: Build prompt
  logInfo('Generating prompt...');
  const prompt = generatePrompt(discovery);
  logSuccess('Prompt generated.');

  // Step 3: Call Gemini
  logInfo('Sending request to Gemini...');
  const script = await generatePlaywrightScript(prompt);
  logSuccess('Gemini response received.');

  // Step 4: Clean response (remove markdown code fences if present)
  let cleanScript = script;
  if (cleanScript.startsWith('```typescript')) {
    cleanScript = cleanScript.slice('```typescript'.length);
  } else if (cleanScript.startsWith('```ts')) {
    cleanScript = cleanScript.slice('```ts'.length);
  } else if (cleanScript.startsWith('```')) {
    cleanScript = cleanScript.slice(3);
  }
  if (cleanScript.endsWith('```')) {
    cleanScript = cleanScript.slice(0, -3);
  }
  cleanScript = cleanScript.trim();

  // Step 5: Save result
  logInfo('Writing Playwright test file...');
  await writeOutputFile(OUTPUT_PATH, cleanScript);
  logSuccess(`Playwright test file written to: ${OUTPUT_PATH}`);
}
