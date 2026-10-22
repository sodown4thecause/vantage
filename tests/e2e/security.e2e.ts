import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Cross-user and admin boundaries on staging, signed in through the saved seo/other sessions.
// seo owns SEO_WS; other owns OTHER_WS. Nothing here writes
// data except the refused POST, which must be refused.

const SEO_WS = 'd5cfcd3f-4419-403d-be5c-38c78d476217';
const OTHER_WS = '4523344c-6cc5-47db-b4de-cf6234512dc1';
const RANDOM_OPP = '6f1c2b7e-9a4d-4c3e-8b21-0d5e7f9a1c33';
const SEO_SECRETS = ['Open-source feature flag service', 'LaunchDarkly', 'Bugbash SEO WS'];

describe('admin boundary', { tags: ['security'] }, () => {
  test('a normal user gets 404 from /admin/switches and its API', { session: 'seo' }, async ({ app, browser }) => {
    await app.open('/admin/switches');
    const text = await browser.evaluate(() => document.body.innerText);
    expect(text).not.toContain('Source switches');
    const status = await browser.evaluate(async () => (await fetch('/api/admin/switches')).status);
    expect(status).toBe(404);
    const body = await browser.evaluate(async () => (await fetch('/api/admin/switches')).text());
    expect(body).not.toContain('switches"');
  });
});

describe('cross-user leak', { tags: ['security'] }, () => {
  test('other cannot open seo workspace pages by workspaceId', { session: 'other' }, async ({ app, browser }) => {
    const paths = [
      `/settings/plan?workspaceId=${SEO_WS}`,
      `/queue?workspaceId=${SEO_WS}`,
      `/review?workspaceId=${SEO_WS}`,
      `/settings/sources?workspaceId=${SEO_WS}`,
      `/settings/digest?workspaceId=${SEO_WS}`,
      `/onboarding?workspaceId=${SEO_WS}`,
      `/seo?workspaceId=${SEO_WS}`,
    ];
    const leaks: string[] = [];
    for (const path of paths) {
      await app.open(path);
      const text = await browser.evaluate(() => document.body.innerText);
      for (const secret of SEO_SECRETS) {
        if (text.includes(secret)) leaks.push(`${path} shows "${secret}"`);
      }
    }
    expect(leaks).toEqual([]);
  });

  test('other cannot read seo data through the API routes', { session: 'other' }, async ({ app, browser }) => {
    await app.open(`/queue?workspaceId=${OTHER_WS}`);
    const urls = [
      `/api/profile?workspaceId=${SEO_WS}`,
      `/api/sources?workspaceId=${SEO_WS}`,
      `/api/outcomes?workspaceId=${SEO_WS}`,
    ];
    const leaks: string[] = [];
    const statuses: number[] = [];
    for (const url of urls) {
      const result = await browser.evaluate(async (u: string) => {
        const r = await fetch(u);
        return { status: r.status, body: await r.text() };
      }, url);
      statuses.push(result.status);
      if (result.status < 400) leaks.push(`${url} returned ${result.status}`);
      for (const secret of SEO_SECRETS) {
        if (result.body.includes(secret)) leaks.push(`${url} body contains "${secret}"`);
      }
    }
    expect(leaks).toEqual([]);
    // Exact status: proves the workspaceId reached the route (an empty value would give 400, not 403).
    expect(statuses).toEqual([403, 403, 403]);
  });

  test('other cannot change seo profile through POST /api/profile', { session: 'other' }, async ({ app, browser }) => {
    await app.open(`/queue?workspaceId=${OTHER_WS}`);
    const status = await browser.evaluate(async (ws: string) => {
      const r = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: ws,
          productUrl: 'https://example.com',
          docsUrls: [],
          productDescription: 'BUGBASH TAMPERED DESCRIPTION',
          targetCustomer: 'platform engineers',
          competitors: ['A', 'B', 'C'],
          topics: ['feature flags'],
        }),
      });
      return r.status;
    }, SEO_WS);
    expect(status).toBe(403);
  });

  test('a random opportunity id shows no data to other', { session: 'other' }, async ({ app, browser }) => {
    await app.open(`/opportunities/${RANDOM_OPP}?workspaceId=${OTHER_WS}`);
    const text = await browser.evaluate(() => document.body.innerText);
    for (const secret of SEO_SECRETS) expect(text).not.toContain(secret);
  });
});

describe('seo profile unchanged', { tags: ['security'] }, () => {
  test('seo profile still has its original description after the refused write', { session: 'seo' }, async ({ app, browser }) => {
    await app.open(`/onboarding?workspaceId=${SEO_WS}`);
    const body = await browser.evaluate(async (ws: string) => (await fetch(`/api/profile?workspaceId=${ws}`)).text(), SEO_WS);
    expect(body).toContain('Open-source feature flag service');
    expect(body).not.toContain('BUGBASH TAMPERED DESCRIPTION');
  });
});
