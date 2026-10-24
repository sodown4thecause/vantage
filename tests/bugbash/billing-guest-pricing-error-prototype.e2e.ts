import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Expected: an unknown ?error= value is ignored (the page renders normally).
// Observed: ?error=constructor looks up ERRORS["constructor"] (Object's prototype) and the page 500s.

describe('billing guest pricing error param', { tags: ['bugbash', 'billing-guest'] }, () => {
  test('pricing with ?error=constructor still renders', async ({ app, screen }) => {
    await app.open('/pricing?error=constructor');
    await expect(screen.getByRole('heading', { level: 1 })).toHaveText('Pricing');
    await expect(screen.getByText('This page couldn’t load')).not.toBeVisible();
  });
});
