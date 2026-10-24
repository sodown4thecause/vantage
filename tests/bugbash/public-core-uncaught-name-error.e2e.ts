import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// The inline theme script in the server HTML calls __name(l10, "l10") without defining __name
// (an esbuild keepNames helper leaking into the output), so it throws on every page load.
type ErrWindow = { __errs: string[] };

describe('public core console errors', { tags: ['bugbash', 'public-core'] }, () => {
  for (const path of ['/', '/pricing', '/tour']) {
    test(`no uncaught page errors on load: ${path}`, async ({ app, browser }) => {
      await browser.addInitScript(() => {
        (window as unknown as ErrWindow).__errs = [];
        addEventListener('error', (e) => (window as unknown as ErrWindow).__errs.push(String(e.message)));
      });
      await app.open(path);
      const errs = await browser.evaluate(() => (window as unknown as ErrWindow).__errs);
      expect(errs).toEqual([]);
    });
  }
});
