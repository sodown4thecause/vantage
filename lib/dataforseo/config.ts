import { fixturesAllowed } from "@/lib/collectors/provenance";

export type DataForSeoEnv = "sandbox" | "live";

export type DataForSeoConfig = {
  env: DataForSeoEnv;
  baseUrl: string;
  login: string;
  password: string;
  dailyBudgetUsd: number;
  reserveFloorUsd: number;
  alertBalanceUsd: number;
};

const usdSetting = (raw: string | undefined, fallback: number): number => {
  const value = raw?.trim() ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/**
 * Null until both credentials are set. Sandbox unless DATAFORSEO_ENV is exactly "live".
 * DATAFORSEO_USERNAME is accepted as an alias for the login; `||` lets a blank LOGIN fall through to it.
 */
export function dataForSeoConfig(env: Record<string, string | undefined> = process.env): DataForSeoConfig | null {
  const login = env.DATAFORSEO_LOGIN?.trim() || env.DATAFORSEO_USERNAME?.trim();
  const password = env.DATAFORSEO_PASSWORD?.trim();
  if (!login || !password) return null;
  const live = env.DATAFORSEO_ENV === "live";
  return {
    env: live ? "live" : "sandbox",
    baseUrl: live ? "https://api.dataforseo.com" : "https://sandbox.dataforseo.com",
    login,
    password,
    dailyBudgetUsd: usdSetting(env.DATAFORSEO_DAILY_BUDGET_USD, 5),
    reserveFloorUsd: usdSetting(env.DATAFORSEO_RESERVE_FLOOR_USD, 15),
    alertBalanceUsd: usdSetting(env.DATAFORSEO_ALERT_BALANCE_USD, 30),
  };
}

/**
 * The config a DataForSEO call may use, or null: unconfigured, or sandbox in production without ALLOW_FIXTURES.
 * Sandbox returns sample data, so production (and staging, which runs NODE_ENV=production) must opt in explicitly.
 */
export function usableDataForSeoConfig(env: NodeJS.ProcessEnv = process.env): DataForSeoConfig | null {
  const config = dataForSeoConfig(env);
  if (!config || (config.env === "sandbox" && !fixturesAllowed(env))) return null;
  return config;
}

/** True when the SEO nav and lookups can run. Pure env reads, so it is safe in server components. */
export function dataForSeoAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return usableDataForSeoConfig(env) !== null;
}
