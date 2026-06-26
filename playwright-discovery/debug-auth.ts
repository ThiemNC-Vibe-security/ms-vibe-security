import 'dotenv/config';
import { chromium } from 'playwright';

const run = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://vc-awg-demo-final-code.vercel.app/login', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  await page.fill('input[type="email"]', process.env.TEST_USER!);
  await page.fill('input[type="password"]', process.env.TEST_PASSWORD!);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);

  console.log('URL after login:', page.url());

  const storage = await page.evaluate(() => {
    const items: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      items[key] = localStorage.getItem(key)!.substring(0, 200);
    }
    return items;
  });
  console.log('localStorage:', JSON.stringify(storage, null, 2));

  const cookies = await context.cookies();
  console.log('cookies count:', cookies.length);
  if (cookies.length > 0) {
    console.log('cookie names:', cookies.map(c => c.name));
  }

  // Try navigate to /transactions on SAME page
  await page.goto('https://vc-awg-demo-final-code.vercel.app/transactions', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);
  console.log('After nav to /transactions:', page.url());

  // Try NEW page in same context
  const page2 = await context.newPage();
  await page2.goto('https://vc-awg-demo-final-code.vercel.app/transactions', { waitUntil: 'load', timeout: 15000 });
  await page2.waitForTimeout(2000);
  console.log('New page /transactions:', page2.url());

  await browser.close();
};

run().catch(console.error);
