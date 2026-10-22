import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('public content', { tags: ['public-content'] }, () => {
  test('launch index lists destinations and one opens', async ({ app, screen, browser }) => {
    await app.open('/launch');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(screen.getByRole('link', 'DevHunt')).toBeVisible();
    await screen.getByRole('link', 'DevHunt').tap();
    await expect(browser).toHaveURL('/launch/devhunt');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('blog index lists a post', async ({ app, screen }) => {
    await app.open('/blog');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(screen.getByRole('link', 'What is buying intent, and how do you spot it in public conversations?', { exact: false })).toBeVisible();
  });

  test('unknown launch slug shows a not-found page', async ({ app, screen }) => {
    await app.open('/launch/does-not-exist');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('blog rss feed is XML with items', async ({ app }) => {
    const r = await fetch(new URL('/blog/rss.xml', app.baseUrl));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type') ?? '').toMatch(/xml/);
    const body = await r.text();
    expect(body).toContain('<rss');
    expect(body).toContain('<item>');
  });

  test('llms.txt is served as text with links', async ({ app }) => {
    const r = await fetch(new URL('/llms.txt', app.baseUrl));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type') ?? '').toMatch(/text\/plain/);
    const body = await r.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain('## Guides');
  });

  test('launch and blog index have no horizontal scroll at 390px', async ({ app, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/launch');
    expect(await browser.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 0)).toBe(true);
    await app.open('/blog');
    expect(await browser.evaluate(() => document.documentElement.scrollWidth - window.innerWidth <= 0)).toBe(true);
  });

  test('launch navigation has no uncaught client errors', async ({ app, screen, browser }) => {
    await app.open('/launch');
    await browser.evaluate(() => {
      (window as unknown as { __errs: string[] }).__errs = [];
      window.addEventListener('error', (e) => (window as unknown as { __errs: string[] }).__errs.push(String(e.message)));
      return null;
    });
    await screen.getByRole('link', 'DevHunt').tap();
    await expect(browser).toHaveURL('/launch/devhunt');
    const errs = await browser.evaluate(() => (window as unknown as { __errs?: string[] }).__errs ?? []);
    expect(errs).toEqual([]);
  });
});
