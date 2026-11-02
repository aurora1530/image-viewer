import type { Page } from '@playwright/test';
import type { requireValue } from '../../src/shared/validation';

declare global {
  interface Window {
    __requireTestValue: typeof requireValue;
  }
}

/** Install in both the current document and future navigations; Playwright serializes this function. */
export async function installBrowserGuards(page: Page) {
  function install() {
    window.__requireTestValue = <T>(value: T | null | undefined): T => {
      if (value === null || value === undefined) throw new Error('Required test value is missing');
      return value;
    };
  }
  await page.addInitScript(install);
  await page.evaluate(install);
}
