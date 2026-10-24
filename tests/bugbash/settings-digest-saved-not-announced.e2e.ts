import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

const WS = '9626a0c6-792e-4fd5-ae4a-f46049aa4843';

// Source: app/components/DigestSettingsForm.tsx renders "Saved." in a plain <p> with no role="status",
// unlike the sources forms (role="status"). The confirmation is visible but not announced to assistive tech.
describe('settings: digest save confirmation is announced', { tags: ['bugbash', 'settings'] }, () => {
  test('saving the digest announces Saved. in a status region', { session: 'settings' }, async ({ app, screen }) => {
    await app.open(`/settings/digest?workspaceId=${WS}`);
    await screen.getByRole('button', 'Save digest settings').tap();
    await expect(screen.getByRole('status').getByText('Saved.')).toBeVisible();
  });
});
