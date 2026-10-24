import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// A signed-in Free user pressing "Upgrade to Pro" must be sent onward (a Polar checkout, or
// /pricing?error=... when billing is not configured). It must never get a bare 500.
describe('signed-in upgrade', { tags: ['bugbash', 'billing'] }, () => {
  test('Upgrade to Pro answers a redirect, not a 500', { session: 'pro' }, async ({ app, screen, browser }) => {
    await app.open('/pricing');
    const response = browser.waitForResponse(/\/api\/billing\/checkout/);
    await screen.getByRole('region', 'Pro monthly').getByRole('button', 'Upgrade to Pro').tap();
    const res = await response;
    expect(res.status).toBe(303);
  });

  test('Manage subscription portal answers a redirect, not a 500', { session: 'pro' }, async ({ app, browser }) => {
    await app.open('/');
    const status = await browser.evaluate(async () => (await fetch('/api/billing/portal', { redirect: 'manual' })).status);
    // fetch with redirect: 'manual' reports a redirect as an opaque response with status 0.
    expect(status).toBe(0);
  });
});
