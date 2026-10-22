import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('public core pricing price', { tags: ['bugbash', 'public-core'] }, () => {
  test('Pro monthly plan shows $19/month', async ({ app, screen }) => {
    await app.open('/pricing');
    await expect(screen.getByText('$19/month')).toBeVisible();
  });
});
