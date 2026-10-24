import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Bug: a non-UUID opportunity id reaches Postgres uuid comparison in getOpportunityDetail
// (no UUID check before the query), so signed-in users get the generic server error page.
// Expected: the same not-found message used for unknown ids.
const WS = '1ad15115-9dd2-4104-9b57-7178bedd67f8';

describe('core: opportunity page with a malformed id', { tags: ['bugbash', 'core'] }, () => {
  test('not-a-uuid shows a not-found message, not the server error page', { session: 'core' }, async ({ app, screen }) => {
    await app.open(`/opportunities/not-a-uuid?workspaceId=${WS}`);
    await expect(screen.getByText('This page couldn’t load')).toBeHidden();
    await expect(screen.getByText('This opportunity is no longer in your queue.')).toBeVisible();
  });
});
