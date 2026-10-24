import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Expected: the pricing page logs no uncaught errors.
// Observed: server HTML inline script calls __name(...) which is undefined in the browser
// (a bundler keepNames helper leaked into the shared layout output; also on / and /success).

describe('billing guest console errors', { tags: ['bugbash', 'billing-guest'] }, () => {
  test('pricing logs no uncaught errors', async ({ app, browser }) => {
    await browser.addInitScript(() => {
      (window as unknown as { __errs: string[] }).__errs = [];
      window.addEventListener('error', e => {
        (window as unknown as { __errs: string[] }).__errs.push(String(e.message));
      });
    });
    await app.open('/pricing');
    const errs = await browser.evaluate(() => (window as unknown as { __errs: string[] }).__errs);
    expect(errs).toEqual([]);
  });
});
