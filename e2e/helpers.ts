import { expect, type Page } from '@playwright/test';

/** Collects page errors and console errors so each test can assert a clean run. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

export async function stubFonts(page: Page): Promise<void> {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
}

export async function openBattle(page: Page, id: string): Promise<void> {
  await page.goto(`/#/battle/${id}`);
  await page.locator('.viewer').waitFor({ state: 'visible', timeout: 90_000 });
}

export async function openControls(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Controls', exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await expect(page.locator('#menu-controls')).toBeVisible();
}
