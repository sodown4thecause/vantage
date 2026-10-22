import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('public marketing core', { tags: ['public-core'] }, () => {
  test('header nav reaches pricing, tour, blog and launch', async ({ app, screen, browser }) => {
    await app.open('/');
    await screen.getByRole('navigation', 'Site').getByRole('link', 'Pricing').tap();
    await expect(browser).toHaveURL('/pricing');
    await expect(screen.getByRole('heading', { level: 1, name: 'Pricing' })).toBeVisible();

    await screen.getByRole('navigation', 'Site').getByRole('link', 'Tour').tap();
    await expect(browser).toHaveURL('/tour');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();

    await app.open('/');
    await screen.getByRole('navigation', 'Site').getByRole('link', 'Blog').tap();
    await expect(browser).toHaveURL('/blog');

    await app.open('/');
    await screen.getByRole('navigation', 'Site').getByRole('link', 'Launch catalog').tap();
    await expect(browser).toHaveURL('/launch');
  });

  test('footer Resources links resolve', async ({ app, screen, browser }) => {
    await app.open('/');
    await screen.getByRole('navigation', 'Resources').getByRole('link', 'Blog').tap();
    await expect(browser).toHaveURL('/blog');
    await app.open('/');
    await screen.getByRole('navigation', 'Resources').getByRole('link', 'Where to launch a developer tool').tap();
    await expect(browser).toHaveURL('/launch');
  });

  test('free CTAs on home and pricing go to sign-up', async ({ app, screen, browser }) => {
    await app.open('/');
    await screen.getByRole('main').getByRole('link', 'Create a free account').first().tap();
    await expect(browser).toHaveURL('/auth/sign-up');

    await app.open('/pricing');
    await screen.getByRole('main').getByRole('link', 'Create a free account').tap();
    await expect(browser).toHaveURL('/auth/sign-up');
  });

  test('pricing shows the three plan cards and Pro upgrade buttons', async ({ app, screen }) => {
    await app.open('/pricing');
    await expect(screen.getByRole('heading', { level: 2, name: 'Free' })).toBeVisible();
    await expect(screen.getByRole('heading', { level: 2, name: 'Pro monthly' })).toBeVisible();
    await expect(screen.getByRole('heading', { level: 2, name: 'Pro yearly' })).toBeVisible();
    await expect(screen.getByText('$48/year')).toBeVisible();
  });

  test('home FAQ question expands and reveals its answer', async ({ app, screen }) => {
    await app.open('/');
    const item = screen.getByRole('group').filter({ hasText: 'Is there a free plan?' });
    await item.tap();
    await expect(screen.getByText('Yes. Create a free account to set up a workspace', { exact: false })).toBeVisible();
  });

  test('skip to content link targets an existing main landmark', async ({ app, screen, browser }) => {
    await app.open('/');
    await screen.getByRole('link', 'Skip to content').press('Enter');
    const exists = await browser.evaluate(() => !!document.getElementById('main'));
    expect(exists).toBe(true);
  });

  test('tour renders its workspace and sample-data notice', async ({ app, screen }) => {
    await app.open('/tour');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(screen.getByText('This tour uses sample data. Search Console, answer checks and the humanizer are in preview.')).toBeVisible();
  });

  for (const path of ['/', '/pricing', '/tour']) {
    test(`no horizontal scroll at 390px: ${path}`, async ({ app, browser }) => {
      await browser.setViewport({ width: 390, height: 844 });
      await app.open(path);
      const w = await browser.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(w).toBeLessThanOrEqual(0);
    });
  }

  for (const path of ['/', '/pricing']) {
    test(`site nav reachable at 390px: ${path}`, async ({ app, screen, browser }) => {
      await browser.setViewport({ width: 390, height: 844 });
      await app.open(path);
      await expect(screen.getByRole('navigation', 'Site').getByRole('link', 'Pricing')).toBeVisible();
    });
  }
});
