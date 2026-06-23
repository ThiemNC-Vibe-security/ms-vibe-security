import { test, expect } from '@playwright/test';

test('submit contact form', async ({ page }) => {

  await page.goto(
    'https://thiemjason-work.site/contactus'
  );

  await page.getByRole('textbox', {
    name: /name/i
  }).fill('Nguyen Van A');

  await page.getByRole('textbox', {
    name: /email/i
  }).fill('test@gmail.com');

  await page.getByRole('textbox', {
    name: /message/i
  }).fill('Hello Playwright');

  await page.getByRole('button')
    .click();

});