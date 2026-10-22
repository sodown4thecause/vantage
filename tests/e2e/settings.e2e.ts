import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Staging account "settings" owns workspace "Bugbash Settings WS" (created during the bug bash).
const WS = '9626a0c6-792e-4fd5-ae4a-f46049aa4843';
const NIL_WS = '00000000-0000-0000-0000-000000000000';

describe('settings: sources, digest and plan', { tags: ['settings'] }, () => {
  test('sources page lists the workspace sources', { session: 'settings' }, async ({ app, screen }) => {
    await app.open(`/settings/sources?workspaceId=${WS}`);
    await expect(screen.getByRole('heading', 'Sources')).toBeVisible();
    const rows = screen.getByTestId('sources-list');
    await expect(rows.getByText('Profile: Hacker News')).toBeVisible();
    await expect(rows.getByText('RSS: hnrss.org', { exact: false }).first()).toBeVisible();
  });

  test('a search source name is rendered as escaped text and no script runs', { session: 'settings' }, async ({ app, screen, browser }) => {
    await app.open(`/settings/sources?workspaceId=${WS}`);
    await expect(screen.getByText('Search (Hacker News):', { exact: false }).first()).toBeVisible();
    expect(await browser.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? null)).toBeNull();
  });

  test('an invalid feed URL is blocked by the browser before submit', { session: 'settings' }, async ({ app, screen, browser }) => {
    await app.open(`/settings/sources?workspaceId=${WS}`);
    await screen.getByLabel('RSS or Substack feed URL').fill('not a url');
    await screen.getByRole('button', 'Add feed').tap();
    const valid = await browser.evaluate(() => (document.getElementById('feed-url') as HTMLInputElement).validity.valid);
    expect(valid).toBe(false);
  });

  test('a private-network feed URL is refused with a clear message', { session: 'settings' }, async ({ app, screen }) => {
    await app.open(`/settings/sources?workspaceId=${WS}`);
    await screen.getByLabel('RSS or Substack feed URL').fill('http://127.0.0.1/feed');
    await screen.getByRole('button', 'Add feed').tap();
    await expect(screen.getByRole('alert').getByText('Enter a public HTTP(S) feed URL.')).toBeVisible();
  });

  test('an over-length feed URL gets a visible message, not a server error', { session: 'settings' }, async ({ app, screen }) => {
    await app.open(`/settings/sources?workspaceId=${WS}`);
    // fill() bypasses the input maxlength. At the Free limit the message is the plan-limit one, which is also acceptable.
    await screen.getByLabel('RSS or Substack feed URL').fill(`https://example.com/${'a'.repeat(2100)}`);
    await screen.getByRole('button', 'Add feed').tap();
    await expect(screen.getByRole('alert').getByText(/Enter a public HTTP\(S\) feed URL\.|allows 8 sources/)).toBeVisible();
  });

  test('a source beyond the Free limit is blocked with a limit message', { session: 'settings' }, async ({ app, screen }) => {
    // The bug bash filled this Free workspace to its 8-source limit; the 9th add must be refused clearly.
    await app.open(`/settings/sources?workspaceId=${WS}`);
    await screen.getByLabel('RSS or Substack feed URL').fill('https://hnrss.org/newest?q=ssl');
    await screen.getByRole('button', 'Add feed').tap();
    await expect(screen.getByRole('alert').getByText('Your Free plan allows 8 sources. Upgrade for more.')).toBeVisible();
  });

  test('digest hour saves and survives a reload, then is restored', { session: 'settings' }, async ({ app, screen, browser }) => {
    await app.open(`/settings/digest?workspaceId=${WS}`);
    await screen.getByLabel('Delivery hour (UTC)').selectOption('09:00');
    await screen.getByRole('button', 'Save digest settings').tap();
    await app.open(`/settings/digest?workspaceId=${WS}`);
    expect(await browser.evaluate(() => (document.getElementById('digest-hour') as HTMLSelectElement).value)).toBe('9');
    await screen.getByLabel('Delivery hour (UTC)').selectOption('13:00');
    await screen.getByRole('button', 'Save digest settings').tap();
  });

  test('digest delivery address is validated before submit', { session: 'settings' }, async ({ app, screen, browser }) => {
    await app.open(`/settings/digest?workspaceId=${WS}`);
    await screen.getByLabel('Delivery address').fill('nope');
    await screen.getByRole('button', 'Save digest settings').tap();
    const valid = await browser.evaluate(() => (document.getElementById('digest-email') as HTMLInputElement).validity.valid);
    expect(valid).toBe(false);
  });

  test('plan page shows Free plan usage matching the limits', { session: 'settings' }, async ({ app, screen }) => {
    await app.open(`/settings/plan?workspaceId=${WS}`);
    await expect(screen.getByTestId('plan-name')).toHaveText(/free/i);
    const rows = screen.getByTestId('plan-usage-row');
    await expect(rows.getByText('8 of 8')).toBeVisible();
    await expect(rows.getByText('3 of 5')).toBeVisible();
    await expect(rows.getByText('0 of 20')).toBeVisible();
    await expect(screen.getByText('Scheduled scans run every 24 hours on this plan.', { exact: false })).toBeVisible();
    await expect(screen.getByText('Reply Briefs and 3-hourly alerts are part of Pro.', { exact: false })).toBeVisible();
    await expect(screen.getByRole('link', 'Upgrade to Pro')).toHaveAttribute('href', '/pricing');
  });

  test('plan page for a nonexistent workspace shows an error and no data', { session: 'settings' }, async ({ app, screen }) => {
    await app.open(`/settings/plan?workspaceId=${NIL_WS}`);
    await expect(screen.getByRole('alert').getByText('Unable to load plan and usage for this workspace.')).toBeVisible();
    await expect(screen.getByTestId('plan-name')).toBeHidden();
  });

  test('settings forms have visible labels', { session: 'settings' }, async ({ app, screen }) => {
    await app.open(`/settings/sources?workspaceId=${WS}`);
    await expect(screen.getByLabel('Search for')).toBeVisible();
    await expect(screen.getByLabel('RSS or Substack feed URL')).toBeVisible();
    await app.open(`/settings/digest?workspaceId=${WS}`);
    await expect(screen.getByLabel('Delivery address')).toBeVisible();
    await expect(screen.getByLabel('Delivery hour (UTC)')).toBeVisible();
  });
});
