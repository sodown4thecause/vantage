import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Each saved sign-in still works after a fresh page load: the session cookie persists.
const ACCOUNTS = ['free', 'pro', 'other', 'core', 'settings', 'seo'] as const;

describe('signed-in sessions', { tags: ['auth'] }, () => {
  for (const name of ACCOUNTS) {
    test(`${name} stays signed in across a reload`, { session: name }, async ({ app, screen, browser }) => {
      await app.open('/');
      await browser.reload();
      // A workspace owner is sent on to /queue (its "Workspace" nav); a new account stays on the "Site" nav.
      await expect(screen.getByRole('banner').getByRole('link', 'Sign out')).toBeVisible();
    });
  }
});
