import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// lib/profile/validate.ts: asStringList() stops collecting at MAX_COMPETITORS (5), so the
// "Provide at most 5 competitors." branch can never run and a 6th competitor is silently dropped.
describe('onboarding competitor limit', { tags: ['bugbash', 'onboarding'] }, () => {
  test('six competitors are rejected with a visible error, not silently dropped', { session: 'free' }, async ({ app, screen }) => {
    await app.open('/onboarding');
    await screen.getByRole('textbox', 'Product URL').fill('https://example.com');
    await screen.getByRole('textbox', 'Product description').fill('Developer analytics for API teams');
    await screen.getByRole('textbox', 'Target customer').fill('API platform teams');
    await screen.getByRole('textbox', 'Competitors (3–5, one per line)').fill('Alpha\nBravo\nCharlie\nDelta\nEcho\nFoxtrot');
    await screen.getByRole('textbox', 'Important topics / problems (one per line)').fill('api monitoring');
    await screen.getByRole('button', 'Save monitoring profile').tap();
    await expect(screen.getByText('Provide at most 5 competitors.')).toBeVisible();
  });
});
