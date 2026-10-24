import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { Screen } from 'e2e';

// The free account's workspace already exists (created through /setup during the bug bash),
// so /onboarding opens the monitoring-profile form directly.
const XSS = '"><img src=x onerror="window.__xss=1"><script>window.__xss=1</script>';

async function fillProfile(screen: Screen, overrides: { productUrl?: string; description?: string } = {}) {
  await screen.getByRole('textbox', 'Product URL').fill(overrides.productUrl ?? 'https://example.com');
  await screen.getByRole('textbox', 'Product description').fill(overrides.description ?? 'Developer analytics for API teams');
  await screen.getByRole('textbox', 'Target customer').fill('API platform teams');
  await screen.getByRole('textbox', 'Competitors (3–5, one per line)').fill('Postman\nInsomnia\nHoppscotch');
  await screen.getByRole('textbox', 'Important topics / problems (one per line)').fill('api monitoring\nopenapi');
}

describe('onboarding', { tags: ['onboarding'] }, () => {
  test('every profile field has a visible label', { session: 'free' }, async ({ app, screen }) => {
    await app.open('/onboarding');
    for (const name of [
      'Product URL',
      'Product description',
      'Target customer',
      'Competitors (3–5, one per line)',
      'Important topics / problems (one per line)',
    ]) {
      await expect(screen.getByRole('textbox', name)).toBeVisible();
    }
  });

  test('a private product URL is refused with a field error', { session: 'free' }, async ({ app, screen }) => {
    await app.open('/onboarding');
    await fillProfile(screen, { productUrl: 'http://127.0.0.1/' });
    await screen.getByRole('button', 'Save monitoring profile').tap();
    await expect(screen.getByText('Product URL must be a valid http(s) URL.')).toBeVisible();
  });

  test('an over-long description is refused with a field error', { session: 'free' }, async ({ app, screen }) => {
    await app.open('/onboarding');
    await fillProfile(screen, { description: 'x'.repeat(8_001) });
    await screen.getByRole('button', 'Save monitoring profile').tap();
    await expect(screen.getByText('Product description must be ≤ 8000 characters.')).toBeVisible({ timeout: 20_000 });
  });

  test('a saved profile persists after a reload and markup in it stays inert', { session: 'free' }, async ({ app, screen, browser }) => {
    await app.open('/onboarding');
    const description = `Developer analytics for API teams ${XSS}`;
    await fillProfile(screen, { description });
    await screen.getByRole('button', 'Save monitoring profile').tap();
    await expect(screen.getByText(/^Saved monitoring profile version \d+\.$/)).toBeVisible({ timeout: 20_000 });

    await browser.reload();
    await expect(screen.getByRole('textbox', 'Product description')).toHaveValue(description);
    await expect(screen.getByRole('textbox', 'Target customer')).toHaveValue('API platform teams');
    expect(await browser.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null)).toBeNull();
  });

  test('a workspace name containing markup renders as text', { session: 'free' }, async ({ app, screen, browser }) => {
    await app.open('/workspaces');
    await expect(screen.getByText(XSS, { exact: false })).toBeVisible();
    expect(await browser.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null)).toBeNull();
  });
});
