import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Staging account "core" owns workspace "Bugbash Core WS" (created during the bug bash).
const WS = '1ad15115-9dd2-4104-9b57-7178bedd67f8';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

describe('core: queue and review empty states', { tags: ['core'] }, () => {
  test('queue shows a clear empty state for a workspace with no opportunities', { session: 'core' }, async ({ app, screen }) => {
    await app.open(`/queue?workspaceId=${WS}`);
    await expect(screen.getByRole('heading', "Today's opportunities")).toBeVisible();
    await expect(screen.getByText('Nothing strong right now.')).toBeVisible();
    await expect(screen.getByRole('link', 'refine your monitoring profile')).toHaveAttribute(
      'href',
      `/onboarding?workspaceId=${WS}`,
    );
  });

  test('queue scan control is a labelled button', { session: 'core' }, async ({ app, screen }) => {
    await app.open(`/queue?workspaceId=${WS}`);
    await expect(screen.getByRole('button', 'Scan now')).toBeVisible();
  });

  test('review page renders its heading and an empty message without an error', { session: 'core' }, async ({ app, screen }) => {
    await app.open(`/review?workspaceId=${WS}`);
    await expect(screen.getByRole('heading', 'Review queue')).toBeVisible();
    await expect(screen.getByText('No leads yet.', { exact: false })).toBeVisible();
    await expect(screen.getByText('Unable to load this review queue.')).toBeHidden();
  });
});

describe('core: opportunity routes', { tags: ['core'] }, () => {
  test('a well-formed unknown opportunity id shows the not-found message, not a server error', { session: 'core' }, async ({
    app,
    screen,
  }) => {
    await app.open(`/opportunities/${NIL_UUID}?workspaceId=${WS}`);
    await expect(screen.getByText('This opportunity is no longer in your queue.')).toBeVisible();
    await expect(screen.getByRole('link', 'Back to queue')).toHaveAttribute('href', `/queue?workspaceId=${WS}`);
  });

  test('opportunity page without workspaceId asks the user to open it from the queue', { session: 'core' }, async ({ app, screen }) => {
    await app.open(`/opportunities/${NIL_UUID}`);
    await expect(screen.getByText('Open this opportunity from your queue', { exact: false })).toBeVisible();
  });
});

describe('core: signed-in API boundaries', { tags: ['core'] }, () => {
  test('own workspace GETs return 200 for outcomes, drafts and plays', { session: 'core' }, async ({ app, browser }) => {
    await app.open(`/queue?workspaceId=${WS}`);
    const statuses = await browser.evaluate(async () => {
      const ws = '1ad15115-9dd2-4104-9b57-7178bedd67f8';
      const nil = '00000000-0000-0000-0000-000000000000';
      const get = (u: string) => fetch(u).then((r) => r.status);
      return {
        outcomes: await get(`/api/outcomes?workspaceId=${ws}`),
        plays: await get(`/api/plays?workspaceId=${ws}&opportunityId=${nil}`),
        drafts: await get(`/api/drafts?workspaceId=${ws}&opportunityId=${nil}`),
      };
    });
    expect(statuses.outcomes).toBe(200);
    expect(statuses.plays).toBe(200);
    expect(statuses.drafts).toBe(200);
  });

  test('a workspace the account does not belong to is refused, never read', { session: 'core' }, async ({ app, browser }) => {
    await app.open(`/queue?workspaceId=${WS}`);
    const statuses = await browser.evaluate(async () => {
      const other = '11111111-2222-4333-8444-555555555555';
      const get = (u: string) => fetch(u).then((r) => r.status);
      return {
        outcomes: await get(`/api/outcomes?workspaceId=${other}`),
        drafts: await get(`/api/drafts?workspaceId=${other}&opportunityId=${other}`),
        plays: await get(`/api/plays?workspaceId=${other}&opportunityId=${other}`),
      };
    });
    expect(statuses).toEqual({ outcomes: expect.any(Number), drafts: expect.any(Number), plays: expect.any(Number) });
    for (const status of [statuses.outcomes, statuses.drafts, statuses.plays]) {
      expect([401, 403, 404]).toContain(status);
    }
  });

  test('POST /api/outcomes with an invalid event is a clean 400', { session: 'core' }, async ({ app, browser }) => {
    await app.open(`/queue?workspaceId=${WS}`);
    const result = await browser.evaluate(async () => {
      const r = await fetch('/api/outcomes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: '1ad15115-9dd2-4104-9b57-7178bedd67f8',
          opportunityId: '00000000-0000-0000-0000-000000000000',
          event: 'not_a_real_event',
        }),
      });
      return { status: r.status, body: await r.text() };
    });
    expect(result.status).toBe(400);
    expect(result.body).toContain('invalid event');
  });

  test('GET /api/plays rejects a non-UUID opportunity id with 400', { session: 'core' }, async ({ app, browser }) => {
    await app.open(`/queue?workspaceId=${WS}`);
    const status = await browser.evaluate(() =>
      fetch('/api/plays?workspaceId=1ad15115-9dd2-4104-9b57-7178bedd67f8&opportunityId=not-a-uuid').then((r) => r.status),
    );
    expect(status).toBe(400);
  });
});
