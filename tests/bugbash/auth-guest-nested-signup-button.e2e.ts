import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('auth-guest: sign-in/sign-up cross links are valid interactive markup', { tags: ['bugbash', 'auth-guest'] }, () => {
  test('the "Sign Up" link on sign-in does not contain a nested button', async ({ app, browser, screen }) => {
    await app.open('/auth/sign-in');
    await expect(screen.getByRole('link', 'Sign Up')).toBeVisible();
    const nested = await browser.evaluate(() => document.querySelectorAll('a[href="/auth/sign-up"] button').length);
    expect(nested).toBe(0);
  });
});
