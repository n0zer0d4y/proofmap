import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';

/** The fixture page built by `npm run e2e:prepare`. */
export const fixtureUrl = pathToFileURL(new URL('../out/fixture.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href;

/** Records every request; anything other than the page itself (file://) counts as external. */
export function trackRequests(page: Page): string[] {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  return external;
}
