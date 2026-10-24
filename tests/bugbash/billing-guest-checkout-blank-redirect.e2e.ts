import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Expected (per app/api/billing/checkout source): a logged-out POST answers 303 to /auth/sign-in.
// Observed on staging: the browser stays on /api/billing/checkout with a blank page.

describe('billing guest checkout redirect', { tags: ['bugbash', 'billing-guest'] }, () => {
  test('logged-out Upgrade to Pro redirects to sign-in', async ({ app, screen, browser }) => {
    await app.open('/pricing');
    const response = browser.waitForResponse(/\/api\/billing\/checkout/);
    await screen.getByRole('region', 'Pro monthly').getByRole('button', 'Upgrade to Pro').tap();
    const res = await response;
    expect(res.status).toBe(303);
    await expect(browser).toHaveURL('/auth/sign-in');
    await expect(screen.getByRole('button', 'Login')).toBeVisible();
  });
});
