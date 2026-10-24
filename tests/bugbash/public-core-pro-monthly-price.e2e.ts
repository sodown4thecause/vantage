import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('public core pricing price', { tags: ['public-core'] }, () => {
  test('Pro monthly plan shows $5/month', async ({ app, screen }) => {
    await app.open('/pricing');
    await expect(screen.getByRole('region', 'Pro monthly').getByText('$5/month')).toBeVisible();
  });
});
