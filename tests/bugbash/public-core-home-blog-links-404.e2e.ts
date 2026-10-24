import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('public core home blog links', { tags: ['bugbash', 'public-core'] }, () => {
  test('"From the blog" post links on home resolve to a page', async ({ app, screen }) => {
    await app.open('/');
    const link = screen.getByRole('link', 'How to find customers on Reddit without spamming');
    await expect(link).toBeVisible();
    const r = await fetch(new URL('/blog/find-customers-on-reddit-without-spamming', app.baseUrl));
    expect(r.status).toBe(200);
  });
});
