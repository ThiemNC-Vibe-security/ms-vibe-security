import 'dotenv/config';
import { generate } from './generators/playwright.generator.js';
import { logError } from './utils/logger.util.js';

async function main(): Promise<void> {
  try {
    await generate();
  } catch (error) {
    if (error instanceof Error) {
      logError(error.message);
    } else {
      logError('An unexpected error occurred.');
    }
    process.exit(1);
  }
}

main();
