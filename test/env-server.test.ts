import { describe, expect, it } from "vitest";

import {
  cronSecret,
  databaseUrl,
  fixturesAllowed,
  learningEnabled,
  neonAuthBaseUrl,
  optionalEnv,
  productHuntDevToken,
} from "@/lib/env/server";

describe("env server accessors", () => {
  it("returns trimmed optional values and undefined for blanks", () => {
    expect(optionalEnv("TOKEN", { TOKEN: "  value  " })).toBe("value");
    expect(optionalEnv("TOKEN", { TOKEN: "   " })).toBeUndefined();
    expect(optionalEnv("TOKEN", {})).toBeUndefined();
  });

  it("requires DATABASE_URL with a setup hint", () => {
    expect(databaseUrl({ DATABASE_URL: "postgres://x" })).toBe("postgres://x");
    expect(() => databaseUrl({})).toThrow(
      /DATABASE_URL is not configured.*\.env\.local/,
    );
  });

  it("requires Neon Auth values", () => {
    expect(neonAuthBaseUrl({ NEON_AUTH_BASE_URL: "https://auth" })).toBe(
      "https://auth",
    );
    expect(() => neonAuthBaseUrl({})).toThrow(/NEON_AUTH_BASE_URL/);
  });

  it("treats CRON_SECRET and collector tokens as optional", () => {
    expect(cronSecret({})).toBeUndefined();
    expect(cronSecret({ CRON_SECRET: "s3cret" })).toBe("s3cret");
    expect(productHuntDevToken({ PH_DEV_TOKEN: " " })).toBeUndefined();
  });

  it("treats LEARNING_ENABLED as an explicit opt-in flag", () => {
    expect(learningEnabled({})).toBe(false);
    expect(learningEnabled({ LEARNING_ENABLED: "true" })).toBe(true);
    expect(learningEnabled({ LEARNING_ENABLED: "1" })).toBe(false);
  });

  it("only allows fixtures outside production or with an explicit override", () => {
    expect(fixturesAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(fixturesAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(
      fixturesAllowed({ NODE_ENV: "production", ALLOW_FIXTURES: "true" }),
    ).toBe(true);
  });
});
