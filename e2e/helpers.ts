import type { Page } from '@playwright/test';

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

type Patch = Record<string, unknown>;
/** Drive the viewer store directly when a test is about the scene, not the control that got it there. */
export async function setState(page: Page, patch: Patch): Promise<void> {
  await page.evaluate((p) => window.__honorCic!.store.set(p as never), patch);
}

export async function state<T = unknown>(page: Page, key: string): Promise<T> {
  return page.evaluate((k) => (window.__honorCic!.store.get() as unknown as Record<string, unknown>)[k], key) as Promise<T>;
}
