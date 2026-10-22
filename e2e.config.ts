import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { config as loadEnv } from 'dotenv';

// Test-account passwords live in the git-ignored .env.local, never in this file.
loadEnv({ path: '.env.local', quiet: true });

// Staging by default. Never point this at https://contextfor.dev: Polar there is live.
const appUrl = process.env.APP_URL ?? 'https://vantage-staging.liam-wilson1990.workers.dev';
if (/^https?:\/\/(www\.)?contextfor\.dev/.test(appUrl)) {
  throw new Error('e2e must not run against production (contextfor.dev)');
}

// An account is declared only when both its variables are set, so a missing
// password never fails config loading for the public-page tests.
// One disposable staging account per area, so parallel runs never see each other's edits.
const ACCOUNT_NAMES = ['free', 'pro', 'other', 'core', 'settings', 'seo'] as const;
const accounts: Record<string, { username: string; password: string }> = {};
for (const name of ACCOUNT_NAMES) {
  const username = process.env[`E2E_${name.toUpperCase()}_EMAIL`];
  const password = process.env[`E2E_${name.toUpperCase()}_PASSWORD`];
  if (username && password) accounts[name] = { username, password };
}

export default {
  targets: [
    {
      name: 'web',
      engine: web(),
      app: { url: appUrl },
    },
  ],
  tests: ['tests/**/*.e2e.ts'],
  credentials: accounts,
  // A deployed Worker can cold-start; give actions and assertions headroom.
  actionTimeout: 30_000,
  assertionTimeout: 15_000,
} satisfies E2EConfig;
