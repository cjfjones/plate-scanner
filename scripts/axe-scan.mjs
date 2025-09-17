import { test, expect } from '@playwright/test';
import axe from '@axe-core/playwright';

test('axe a11y scan on key pages', async ({ page }) => {
  const pages = ['index.html']; // add more routes
  for (const p of pages) {
    await page.goto(`http://localhost:4173/${p}`);
    await axe.attach(page);
    const results = await axe.scan(page);
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
  }
});
