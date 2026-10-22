import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('auth-guest: sign-up buttons have accessible names', { tags: ['bugbash', 'auth-guest'] }, () => {
  test('every button on sign-up has an accessible name', async ({ app, browser, screen }) => {
    await app.open('/auth/sign-up');
    await expect(screen.getByRole('button', 'Create an account')).toBeVisible();
    const unnamed = await browser.evaluate(
      () =>
        Array.from(document.querySelectorAll('button')).filter(
          (b) =>
            !(b.textContent ?? '').trim() &&
            !b.getAttribute('aria-label') &&
            !b.getAttribute('aria-labelledby') &&
            !b.getAttribute('title'),
        ).length,
    );
    expect(unnamed).toBe(0);
  });
});
