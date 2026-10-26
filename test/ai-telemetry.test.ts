import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  posthogProcessorOptions: [] as Array<Record<string, unknown>>,
  tracerProviderOptions: [] as Array<Record<string, unknown>>,
  telemetryOptions: [] as Array<Record<string, unknown>>,
  registerTelemetry: vi.fn(),
  forceFlush: vi.fn(async () => undefined),
  waitUntil: vi.fn(),
}));

vi.mock("@posthog/ai/otel", () => ({
  PostHogSpanProcessor: class {
    constructor(options: Record<string, unknown>) {
      mocks.posthogProcessorOptions.push(options);
    }
  },
}));
vi.mock("@opentelemetry/sdk-trace-base", () => ({
  BasicTracerProvider: class {
    constructor(options: Record<string, unknown>) {
      mocks.tracerProviderOptions.push(options);
    }
    getTracer(name: string) {
      return { name };
    }
    forceFlush() {
      return mocks.forceFlush();
    }
  },
}));
vi.mock("@ai-sdk/otel", () => ({
  OpenTelemetry: class {
    constructor(options: Record<string, unknown>) {
      mocks.telemetryOptions.push(options);
    }
  },
}));
vi.mock("ai", () => ({ registerTelemetry: mocks.registerTelemetry }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ ctx: { waitUntil: mocks.waitUntil } }),
}));

import { aiTelemetryContext, aiTelemetrySettings, flushPostHogAiTelemetry, posthogAiTelemetry } from "@/lib/analytics/ai-telemetry";

const singleton = globalThis as typeof globalThis & { __vantagePostHogAiTelemetry?: unknown };

beforeEach(() => {
  delete singleton.__vantagePostHogAiTelemetry;
  mocks.posthogProcessorOptions.length = 0;
  mocks.tracerProviderOptions.length = 0;
  mocks.telemetryOptions.length = 0;
  mocks.registerTelemetry.mockReset();
  mocks.forceFlush.mockReset();
  mocks.forceFlush.mockResolvedValue(undefined);
  mocks.waitUntil.mockReset();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");
  vi.stubEnv("VANTAGE_DEPLOY_ENV", "production");
  vi.stubEnv("POSTHOG_LLM_CAPTURE_CONTENT", "0");
});

afterEach(() => {
  delete singleton.__vantagePostHogAiTelemetry;
  vi.unstubAllEnvs();
});

describe("privacy-first AI telemetry", () => {
  it("disables telemetry when the existing public project token is absent and strips content by default", () => {
    expect(aiTelemetrySettings("seo.classify")).toMatchObject({
      isEnabled: false,
      functionId: "seo.classify",
      recordInputs: false,
      recordOutputs: false,
    });
    expect(posthogAiTelemetry("seo.classify").isEnabled).toBe(false);
    expect(mocks.registerTelemetry).not.toHaveBeenCalled();
  });

  it("registers one BasicTracerProvider-backed PostHog processor and keeps content out by default", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_public_project_token");
    expect(posthogAiTelemetry("seo.research_answer")).toMatchObject({
      isEnabled: true,
      functionId: "seo.research_answer",
      recordInputs: false,
      recordOutputs: false,
    });
    posthogAiTelemetry("seo.research_fallback");
    expect(mocks.registerTelemetry).toHaveBeenCalledTimes(1);
    expect(mocks.posthogProcessorOptions[0]).toMatchObject({
      host: "https://us.i.posthog.com",
      privacyMode: true,
    });
    expect(mocks.tracerProviderOptions[0]).toHaveProperty("spanProcessors");
    expect(mocks.telemetryOptions[0]).toMatchObject({ usage: true, providerMetadata: false });
  });

  it("allows input/output capture only when explicitly enabled in staging", () => {
    const staging = {
      NEXT_PUBLIC_POSTHOG_KEY: "phc_public_project_token",
      VANTAGE_DEPLOY_ENV: "staging",
      POSTHOG_LLM_CAPTURE_CONTENT: "1",
    };
    expect(aiTelemetrySettings("interview.profile_draft", staging)).toMatchObject({
      isEnabled: true,
      recordInputs: true,
      recordOutputs: true,
    });
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", staging.NEXT_PUBLIC_POSTHOG_KEY);
    vi.stubEnv("VANTAGE_DEPLOY_ENV", staging.VANTAGE_DEPLOY_ENV);
    vi.stubEnv("POSTHOG_LLM_CAPTURE_CONTENT", staging.POSTHOG_LLM_CAPTURE_CONTENT);
    posthogAiTelemetry("interview.profile_draft");
    expect(mocks.posthogProcessorOptions[0]).toMatchObject({ privacyMode: false });

    expect(aiTelemetrySettings("gtm.answer", { ...staging, VANTAGE_DEPLOY_ENV: "production" }).recordInputs).toBe(false);
    expect(aiTelemetrySettings("gtm.answer", { ...staging, POSTHOG_LLM_CAPTURE_CONTENT: "true" }).recordOutputs).toBe(false);
  });

  it("schedules forceFlush through the request context waitUntil", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_public_project_token");
    posthogAiTelemetry("seo.classify");
    await flushPostHogAiTelemetry();
    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
    await mocks.waitUntil.mock.calls[0]![0];
    expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
  });

  it("passes only the Neon Auth identity and workspace id as runtime metadata", () => {
    expect(aiTelemetryContext("neon-user-123", "workspace-456")).toEqual({
      posthog_distinct_id: "neon-user-123",
      workspaceId: "workspace-456",
    });
    expect(aiTelemetryContext(undefined, "workspace-456")).toEqual({ workspaceId: "workspace-456" });
  });
});
