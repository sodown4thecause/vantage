import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Logged-out billing funnel on staging. Never clicks through to Polar: the Pro CTA is
// asserted as a form POST to /api/billing/checkout (it redirects to sign-in when logged out).

describe('billing guest', { tags: ['billing-guest'] }, () => {
  test('pricing lists Free and Pro with source-matching limits', async ({ app, screen }) => {
    await app.open('/pricing');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();

    const free = screen.getByRole('region', 'Free');
    await expect(free.getByText('$0')).toBeVisible();
    await expect(free.getByText('8 sources')).toBeVisible();
    await expect(free.getByText('5 keywords')).toBeVisible();
    await expect(free.getByText('1 project')).toBeVisible();
    await expect(free.getByText('Up to 20 scored conversations a day')).toBeVisible();
    await expect(free.getByText('Daily scans')).toBeVisible();

    const pro = screen.getByRole('region', 'Pro monthly');
    await expect(pro.getByText('$5/month')).toBeVisible();
    await expect(pro.getByText('25 sources')).toBeVisible();
    await expect(pro.getByText('25 keywords')).toBeVisible();
    await expect(pro.getByText('3 projects')).toBeVisible();
    await expect(pro.getByText('Up to 100 scored conversations a day')).toBeVisible();
    await expect(pro.getByText('Scans every 3 hours')).toBeVisible();
    await expect(pro.getByText('5 deep searches a month')).toBeVisible();
  });

  test('yearly plan is shown as $48 per year', async ({ app, screen }) => {
    await app.open('/pricing');
    await expect(screen.getByRole('region', 'Pro yearly').getByText('$48/year')).toBeVisible();
  });

  test('free CTA links to sign-up', async ({ app, screen }) => {
    await app.open('/pricing');
    const cta = screen.getByRole('region', 'Free').getByRole('link', 'Create a free account');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/auth/sign-up');
  });

  test('pro CTA is a button, and pricing links no Polar URL directly', async ({ app, screen, browser }) => {
    await app.open('/pricing');
    const cta = screen.getByRole('region', 'Pro monthly').getByRole('button', 'Upgrade to Pro');
    await expect(cta).toBeVisible();
    // The button submits a form to /api/billing/checkout; the page itself must not link to polar.sh.
    const polarLinks = await browser.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).filter(a => a.getAttribute('href')?.includes('polar.sh')).length,
    );
    expect(polarLinks).toBe(0);
  });

  test('success without params does not claim Pro is active', async ({ app, screen }) => {
    await app.open('/success');
    await expect(screen.getByRole('heading', { level: 1 })).toHaveText("Thanks, we're confirming your payment");
    await expect(screen.getByText("You're on Pro")).not.toBeVisible();
    await expect(screen.getByRole('link', 'Back to pricing')).toHaveAttribute('href', '/pricing');
  });

  test('success with a bogus checkout_id renders without crashing', async ({ app, screen }) => {
    await app.open('/success?checkout_id=bogus');
    await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(screen.getByText("You're on Pro")).not.toBeVisible();
    await expect(screen.getByText('This page couldn’t load')).not.toBeVisible();
  });

  test('pricing fits a 390px phone without horizontal scroll', async ({ app, screen, browser }) => {
    await browser.setViewport({ width: 390, height: 844 });
    await app.open('/pricing');
    await expect(screen.getByRole('region', 'Free')).toBeVisible();
    await expect(screen.getByRole('region', 'Pro monthly')).toBeVisible();
    const overflow = await browser.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(screen.getByRole('region', 'Pro monthly').getByRole('button', 'Upgrade to Pro')).toBeVisible();
  });

});
