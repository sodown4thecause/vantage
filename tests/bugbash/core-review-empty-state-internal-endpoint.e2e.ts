import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Bug: the /review empty state tells the end user to run "POST /api/pipeline/run", an internal
// endpoint (see the Internal routes in AGENTS.md) that a founder cannot call. The copy should
// describe what the user can do, e.g. refine the monitoring profile or wait for the next scan.
const WS = '1ad15115-9dd2-4104-9b57-7178bedd67f8';

describe('core: review empty state copy', { tags: ['bugbash', 'core'] }, () => {
  test('empty review queue does not ask the user to call an internal API endpoint', { session: 'core' }, async ({ app, screen }) => {
    await app.open(`/review?workspaceId=${WS}`);
    await expect(screen.getByRole('heading', 'Review queue')).toBeVisible();
    await expect(screen.getByText('POST /api/pipeline/run', { exact: false })).toBeHidden();
  });
});
