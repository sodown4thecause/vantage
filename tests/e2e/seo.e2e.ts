import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Regression coverage for the /seo page on staging. The SEO chat form renders only when the SEO agent's
// model gateway is configured (app/seo/page.tsx: seoModels()). Staging is not configured, so the page shows
// its "not set up" notice. The chat UI tests (mocked /seo/chat, no paid calls) are not runnable here until
// staging has AI_GATEWAY_API_KEY set; see the bug bash report.

const SEO_WS = 'd5cfcd3f-4419-403d-be5c-38c78d476217';

describe('seo page', { tags: ['seo'] }, () => {
  test('/seo for the owner shows the SEO heading and the not-set-up notice on staging', { session: 'seo' }, async ({ app, screen, browser }) => {
    await app.open(`/seo?workspaceId=${SEO_WS}`);
    await expect(browser).toHaveURL(/\/seo/);
    await expect(screen.getByRole('heading', 'SEO', { level: 1 })).toBeVisible();
    await expect(screen.getByText('SEO data is not set up yet.')).toBeVisible();
  });
});
