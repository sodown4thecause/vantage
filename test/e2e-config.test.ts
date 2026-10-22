import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@e2e-dev/web', () => ({ web: () => ({}) }));
vi.mock('dotenv', () => ({ config: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test.for([
  'https://contextfor.dev',
  'https://CONTEXTFOR.DEV',
  'http://www.contextfor.dev',
  'https://WWW.CONTEXTFOR.DEV./pricing',
  'https://contextfor.dev.:443',
  'https://user@contextfor.dev',
])('refuses production target %s', async (url) => {
  vi.stubEnv('APP_URL', url);
  await expect(import('@/e2e.config')).rejects.toThrow('e2e must not run against production');
});

test.for([
  'https://vantage-staging.liam-wilson1990.workers.dev',
  'http://localhost:3000',
  'https://preview.example.com',
])('keeps the selected non-production target %s', async (url) => {
  vi.stubEnv('APP_URL', url);
  const { default: config } = await import('@/e2e.config');
  expect(config.targets[0].app.url).toBe(url);
});

test('defaults to staging', async () => {
  vi.stubEnv('APP_URL', undefined);
  const { default: config } = await import('@/e2e.config');
  expect(config.targets[0].app.url).toBe('https://vantage-staging.liam-wilson1990.workers.dev');
});

test('refuses an invalid target URL', async () => {
  vi.stubEnv('APP_URL', 'not a URL');
  await expect(import('@/e2e.config')).rejects.toThrow();
});
