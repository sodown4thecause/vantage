import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const WS = '9626a0c6-792e-4fd5-ae4a-f46049aa4843';

// Observed: the Add feed POST is aborted (net::ERR_FAILED); the button re-enables and no error is shown,
// so the owner gets no feedback that nothing was added. Source: app/source-controls.tsx FeedForm renders
// state.error only, and a rejected server action leaves the state unchanged.
describe('settings: failed feed request is silent', { tags: ['bugbash', 'settings'] }, () => {
  test('a failed Add feed request shows an error alert', { session: 'settings' }, async ({ app, screen, browser }) => {
    await app.open(`/settings/sources?workspaceId=${WS}`);
    await browser.route('**/settings/sources**', (r) => r.abort());
    await screen.getByLabel('RSS or Substack feed URL').fill('https://hnrss.org/newest?q=abort-probe');
    await screen.getByRole('button', 'Add feed').tap();
    await expect(screen.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  });
});
