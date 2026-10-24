import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

// Logged out with no workspaceId: these pages call redirect("/") (origin/main).
const REDIRECTS = ['/queue', '/review', '/onboarding', '/settings/sources', '/settings/digest', '/settings/plan', '/seo'];

// Logged out with an explicit workspaceId: authorizeWorkspace refuses and the page shows its generic error.
const REFUSED: Array<[string, string]> = [
  ['/queue', 'Unable to load this opportunity queue.'],
  ['/review', 'Unable to load this review queue.'],
  ['/onboarding', 'Unable to load onboarding for this workspace.'],
  ['/settings/sources', 'Unable to load sources for this workspace.'],
  ['/settings/digest', 'Unable to load digest settings for this workspace.'],
  ['/settings/plan', 'Unable to load plan and usage for this workspace.'],
  ['/seo', 'Unable to load this page.'],
  [`/opportunities/${NIL_UUID}`, 'Unable to load this opportunity.'],
];

describe('auth-guest: protected pages while logged out', { tags: ['auth-guest'] }, () => {
  for (const path of REDIRECTS) {
    test(`${path} without workspace redirects to /`, async ({ app, browser, screen }) => {
      await app.open(path);
      await expect(browser).toHaveURL('/');
      await expect(screen.getByText("Today's opportunities")).toBeHidden();
      await expect(screen.getByText('Review queue')).toBeHidden();
    });
  }

  test('/opportunities/:id without workspace shows the open-from-queue prompt, not data', async ({ app, screen }) => {
    await app.open(`/opportunities/${NIL_UUID}`);
    await expect(screen.getByText('Open this opportunity from your queue', { exact: false })).toBeVisible();
    await expect(screen.getByText('Back to queue')).toBeHidden();
  });

  for (const [path, message] of REFUSED) {
    test(`${path} with an explicit workspaceId refuses logged-out visitors`, async ({ app, screen }) => {
      await app.open(`${path}?workspaceId=${NIL_UUID}`);
      await expect(screen.getByText(message, { exact: false })).toBeVisible();
    });
  }

  test('/admin/switches is 404 for logged-out visitors', async ({ app }) => {
    const r = await fetch(new URL('/admin/switches', app.baseUrl), { redirect: 'manual' });
    expect(r.status).toBe(404);
  });

  test('/success without a session does not claim a paid upgrade', async ({ app, screen }) => {
    await app.open(`/success?checkout_id=${NIL_UUID}`);
    await expect(screen.getByText("You're on Pro")).toBeHidden();
    await expect(screen.getByText("Thanks, we're confirming your payment")).toBeVisible();
  });
});

describe('auth-guest: sign-in and sign-up pages', { tags: ['auth-guest'] }, () => {
  test('sign-in shows labelled email and password fields', async ({ app, screen }) => {
    await app.open('/auth/sign-in');
    await expect(screen.getByRole('textbox', 'Email')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Password')).toBeVisible();
    await expect(screen.getByRole('button', 'Login')).toBeVisible();
  });

  test('sign-in with a wrong password shows a clear error', async ({ app, screen }) => {
    await app.open('/auth/sign-in');
    await screen.getByRole('textbox', 'Email').fill('bugbash-nobody@example.test');
    await screen.getByRole('textbox', 'Password').fill('WrongPass123!');
    await screen.getByRole('button', 'Login').tap();
    await expect(screen.getByText('Invalid email or password')).toBeVisible();
  });

  test('sign-in submits with Enter from the password field', async ({ app, screen }) => {
    await app.open('/auth/sign-in');
    await screen.getByRole('textbox', 'Email').fill('bugbash-nobody@example.test');
    await screen.getByRole('textbox', 'Password').fill('WrongPass123!');
    await screen.getByRole('textbox', 'Password').press('Enter');
    await expect(screen.getByText('Invalid email or password')).toBeVisible();
  });

  test('sign-in links to sign-up and forgot-password, which resolves', async ({ app, screen }) => {
    await app.open('/auth/sign-in');
    await expect(screen.getByRole('link', 'Sign Up')).toHaveAttribute('href', '/auth/sign-up');
    await expect(screen.getByRole('link', 'Forgot your password?')).toHaveAttribute('href', '/auth/forgot-password');
    const forgot = await fetch(new URL('/auth/forgot-password', app.baseUrl));
    expect(forgot.status).toBe(200);
  });

  test('sign-up shows labelled fields', async ({ app, screen }) => {
    await app.open('/auth/sign-up');
    await expect(screen.getByRole('textbox', 'Name')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Email')).toBeVisible();
    await expect(screen.getByRole('textbox', 'Password')).toBeVisible();
  });

  test('sign-up empty submit shows validation', async ({ app, screen }) => {
    await app.open('/auth/sign-up');
    await screen.getByRole('button', 'Create an account').tap();
    await expect(screen.getByText('Name is required')).toBeVisible();
    await expect(screen.getByText('Email is invalid')).toBeVisible();
    await expect(screen.getByText('Password is required')).toBeVisible();
  });

  test('sign-up rejects a malformed email', async ({ app, screen }) => {
    await app.open('/auth/sign-up');
    await screen.getByRole('textbox', 'Email').fill('not-an-email');
    await screen.getByRole('button', 'Create an account').tap();
    await expect(screen.getByText('Email is invalid')).toBeVisible();
  });

  test('sign-up links back to sign-in', async ({ app, screen }) => {
    await app.open('/auth/sign-up');
    await expect(screen.getByRole('link', 'Sign In')).toHaveAttribute('href', '/auth/sign-in');
  });
});

describe('auth-guest: keyboard, console and injection probes', { tags: ['auth-guest'] }, () => {
  test('sign-in tab order reaches the password field through the forgot-password link', async ({ app, screen }) => {
    await app.open('/auth/sign-in');
    await screen.getByRole('textbox', 'Email').focus();
    await screen.getByRole('textbox', 'Email').press('Tab');
    await expect(screen.getByRole('link', 'Forgot your password?')).toBeFocused();
    await screen.getByRole('link', 'Forgot your password?').press('Tab');
    await expect(screen.getByRole('textbox', 'Password')).toBeFocused();
  });

  test('HTML injected via the email field does not execute', async ({ app, browser, screen }) => {
    const payload = '"><img src=x onerror="window.__xss=1">';
    await app.open('/auth/sign-in');
    await screen.getByRole('textbox', 'Email').fill(payload);
    await screen.getByRole('textbox', 'Password').fill('WrongPass123!');
    await screen.getByRole('button', 'Login').tap();
    await expect(screen.getByRole('textbox', 'Email')).toHaveValue(payload);
    expect(await browser.evaluate('typeof window.__xss')).toBe('undefined');
  });
});

describe('auth-guest: unknown auth paths and expired sessions', { tags: ['auth-guest'] }, () => {
  test('/auth/does-not-exist is a 404, not a 500', async ({ app }) => {
    const r = await fetch(new URL('/auth/does-not-exist', app.baseUrl), { redirect: 'manual' });
    expect(r.status).toBe(404);
  });

  test('garbage session cookie on /queue redirects to / instead of erroring', async ({ app, browser, screen }) => {
    const garbage = 'garbage-not-a-real-session-token';
    await browser.setCookies([
      { name: '__Secure-neon-auth.session_token', value: garbage, url: app.baseUrl! },
      { name: 'neon-auth.session_token', value: garbage, url: app.baseUrl! },
    ]);
    await app.open('/queue');
    await expect(browser).toHaveURL('/');
    await expect(screen.getByText("Today's opportunities")).toBeHidden();
  });
});
