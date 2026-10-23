import { afterEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/debug-sentry/route";
import { scrubEvent, sentryEnvironment, sentryOptions, workerSentryOptions } from "@/lib/observability/sentry-options.mjs";

afterEach(() => {
  delete process.env.SENTRY_ENVIRONMENT;
});

describe("Sentry options", () => {
  it("stays disabled without a DSN", () => {
    expect(sentryOptions({ dsn: undefined }).enabled).toBe(false);
    expect(sentryOptions({ dsn: "  " }).enabled).toBe(false);
    expect(workerSentryOptions(undefined).enabled).toBe(false);
  });

  it("samples 10% of traces, sends no default PII and never enables replay", () => {
    const options = sentryOptions({ dsn: "https://key@o0.ingest.sentry.io/1", environment: "staging" });
    expect(options).toMatchObject({ enabled: true, tracesSampleRate: 0.1, sendDefaultPii: false, environment: "staging" });
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("integrations");
  });

  it("reports only staging or production as the environment", () => {
    expect(sentryEnvironment("staging")).toBe("staging");
    expect(sentryEnvironment("production")).toBe("production");
    expect(sentryEnvironment(undefined)).toBe("production");
    expect(sentryEnvironment("dev")).toBe("production");
  });
});

describe("scrubEvent", () => {
  it("removes cookies, bodies, credential headers and everything about the user but the id", () => {
    const event = scrubEvent({
      request: {
        cookies: { session: "s" },
        data: '{"answer":"secret plans"}',
        headers: { Cookie: "a=b", Authorization: "Bearer t", "webhook-signature": "v1,x", "user-agent": "UA" },
      },
      user: { id: "user_1", email: "founder@example.com", ip_address: "203.0.113.1" },
    });
    expect(event.request).toEqual({
      headers: { Cookie: "[Filtered]", Authorization: "[Filtered]", "webhook-signature": "[Filtered]", "user-agent": "UA" },
    });
    expect(event.user).toEqual({ id: "user_1" });
  });

  it("drops a user without an id", () => {
    expect(scrubEvent({ user: { ip_address: "203.0.113.1" } })).toEqual({});
  });
});

describe("GET /api/debug-sentry", () => {
  it("is not found unless the environment is explicitly staging", () => {
    expect(GET().status).toBe(404);
    process.env.SENTRY_ENVIRONMENT = "production";
    expect(GET().status).toBe(404);
  });

  it("throws a recognisable error in staging", () => {
    process.env.SENTRY_ENVIRONMENT = "staging";
    expect(() => GET()).toThrow(/intentional test error/);
  });
});
