import { test } from '@e2e-dev/web';
import { credentials, expect } from 'e2e';

// One saved sign-in per disposable staging account (see e2e.config.ts and .env.local).
// A fresh account is created on first use: staging sign-up needs no email verification.
const ACCOUNTS = ['free', 'pro', 'other', 'core', 'settings', 'seo'] as const;

for (const name of ACCOUNTS) {
  test.setup(`sign in as ${name}`, { sessions: [name] }, async ({ app, screen, session, browser }) => {
    const user = credentials.user(name);

    await app.open('/auth/sign-in');
    await screen.getByRole('textbox', 'Email').fill(user.username);
    await screen.getByRole('textbox', 'Password').fill(user.password);
    const signIn = browser.waitForResponse(/\/api\/auth\/sign-in\/email/);
    await screen.getByRole('button', 'Login').tap();
    // Neon Auth rate-limits sign-in; a 429 is not a missing account, so never fall through to sign-up.
    expect((await signIn).status, 'sign-in was rate limited (429); wait a minute and rerun').not.toBe(429);

    // Signed in: the app leaves /auth/ (for /setup or a workspace page). Otherwise the account is new.
    try {
      await expect(browser).not.toHaveURL(/\/auth\//, { timeout: 15_000 });
    } catch {
      await app.open('/auth/sign-up');
      await screen.getByRole('textbox', 'Name').fill(`Bugbash ${name}`);
      await screen.getByRole('textbox', 'Email').fill(user.username);
      await screen.getByRole('textbox', 'Password').fill(user.password);
      await screen.getByRole('button', 'Create an account').tap();
      await expect(browser).not.toHaveURL(/\/auth\//, { timeout: 30_000 });
    }

    await session.save(name);
  });
}
