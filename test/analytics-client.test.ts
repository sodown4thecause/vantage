import { afterEach, describe, expect, it, vi } from "vitest";

const { init } = vi.hoisted(() => ({ init: vi.fn() }));

vi.mock("posthog-js", () => ({ default: { init } }));

describe("browser replay privacy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("masks rendered text by default, including workspace conversations", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubGlobal("window", { location: { pathname: "/workspace" } });

    await import("../instrumentation-client");

    expect(init).toHaveBeenCalledWith("phc_test", expect.objectContaining({
      disable_session_recording: false,
      session_recording: expect.objectContaining({
        maskAllInputs: true,
        maskTextSelector: "*",
        blockClass: "ph-no-capture",
      }),
    }));
  });
});
