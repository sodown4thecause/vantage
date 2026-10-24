import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Suspected bug: staging lists blog posts and tags on /blog, but the detail
// and tag pages for those same links return the 404 page.
describe('public content blog post 404', { tags: ['bugbash', 'public-content'] }, () => {
  test('blog post linked from /blog renders its article', async ({ app, screen }) => {
    await app.open('/blog/what-is-buying-intent');
    await expect(screen.getByRole('heading', { level: 1 })).toHaveText(/buying intent/i);
  });
});
