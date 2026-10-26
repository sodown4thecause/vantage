import { afterEach, describe, expect, it, vi } from "vitest";

const { init } = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("posthog-js", () => ({ default: { init } }));

async function load(env: Record<string, string>, pathname = "/workspace") {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.stubGlobal("window", { location: { pathname } });
  await import("../instrumentation-client");
  return init.mock.calls[0]?.[1];
}

describe("browser replay privacy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not initialise PostHog without a key", async () => {
    await load({ NEXT_PUBLIC_POSTHOG_KEY: "" });
    expect(init).not.toHaveBeenCalled();
  });

  it("keeps replay off by default but still honours DNT and captures exceptions", async () => {
    const options = await load({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" });
    expect(options).toMatchObject({
      api_host: "/ingest",
      disable_session_recording: true,
      respect_dnt: true,
      capture_exceptions: true,
      capture_performance: true,
      advanced_disable_feature_flags: false,
    });
  });

  it.each(["true", "0", "yes", ""])("keeps replay off when NEXT_PUBLIC_POSTHOG_REPLAY is %j", async (value) => {
    const options = await load({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test", NEXT_PUBLIC_POSTHOG_REPLAY: value });
    expect(options.disable_session_recording).toBe(true);
  });

  it("enables replay only for the exact value 1, with all text and inputs masked", async () => {
    const options = await load({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test", NEXT_PUBLIC_POSTHOG_REPLAY: "1" });
    expect(options.disable_session_recording).toBe(false);
    expect(options.session_recording).toMatchObject({ maskAllInputs: true, maskTextSelector: "*", blockClass: "ph-no-capture" });
  });

  it("keeps replay off on auth pages even when enabled", async () => {
    const options = await load({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test", NEXT_PUBLIC_POSTHOG_REPLAY: "1" }, "/auth/sign-in");
    expect(options.disable_session_recording).toBe(true);
  });
});
