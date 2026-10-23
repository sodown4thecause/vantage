import { afterEach, describe, expect, it, vi } from "vitest";

import { posthogAssetsHost, posthogHost, posthogUiHost } from "@/lib/analytics/config";
import { FunnelEvent } from "@/lib/analytics/events";
import { captureServerEvent, type ServerAnalyticsDeps } from "@/lib/analytics/server";

function fakeClient(shutdown: () => Promise<void> = async () => {}) {
  return { capture: vi.fn(), shutdown: vi.fn(shutdown) };
}

function deps(overrides: Partial<ServerAnalyticsDeps> & { client?: ServerAnalyticsDeps["client"] } = {}): ServerAnalyticsDeps {
  return { key: () => "phc_test", client: () => fakeClient(), waitUntil: async () => null, ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
});

describe("captureServerEvent", () => {
  it("does nothing without a PostHog key", async () => {
    const client = vi.fn();
    await captureServerEvent(FunnelEvent.SignedUp, "user_1", {}, deps({ key: () => undefined, client }));
    expect(client).not.toHaveBeenCalled();
  });

  it("captures by user id and flushes before resolving outside a Worker", async () => {
    const order: string[] = [];
    const client = fakeClient(async () => { order.push("flushed"); });
    await captureServerEvent(FunnelEvent.CheckoutStarted, "user_1", { plan: "pro_monthly" }, deps({ client: () => client }));
    order.push("returned");
    expect(client.capture).toHaveBeenCalledWith({ distinctId: "user_1", event: "checkout_started", properties: { plan: "pro_monthly" } });
    expect(client.shutdown).toHaveBeenCalledOnce();
    expect(order).toEqual(["flushed", "returned"]);
  });

  it("hands delivery to the Worker's waitUntil when there is one", async () => {
    let release!: () => void;
    const client = fakeClient(() => new Promise<void>((resolve) => { release = resolve; }));
    const waitUntil = vi.fn();
    // Resolves even though delivery is still pending: the Worker keeps it alive.
    await captureServerEvent(FunnelEvent.SignedUp, "user_1", {}, deps({ client: () => client, waitUntil: async () => waitUntil }));
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    release();
  });

  it("never throws when the client or delivery fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(captureServerEvent(FunnelEvent.SignedUp, "user_1", {}, deps({
      client: () => { throw new Error("boom"); },
    }))).resolves.toBeUndefined();
    await expect(captureServerEvent(FunnelEvent.SignedUp, "user_1", {}, deps({
      client: () => fakeClient(async () => { throw new Error("network"); }),
    }))).resolves.toBeUndefined();
  });

  it("skips an empty distinct id rather than merging anonymous users", async () => {
    const client = vi.fn();
    await captureServerEvent(FunnelEvent.SignedUp, "", {}, deps({ client }));
    expect(client).not.toHaveBeenCalled();
  });
});

describe("PostHog hosts", () => {
  it("defaults to the US cloud and maps the assets and app hosts", () => {
    expect(posthogHost()).toBe("https://us.i.posthog.com");
    expect(posthogAssetsHost()).toBe("https://us-assets.i.posthog.com");
    expect(posthogUiHost()).toBe("https://us.posthog.com");
  });

  it("follows an EU host and trims a trailing slash", () => {
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com/";
    expect(posthogHost()).toBe("https://eu.i.posthog.com");
    expect(posthogAssetsHost()).toBe("https://eu-assets.i.posthog.com");
    expect(posthogUiHost()).toBe("https://eu.posthog.com");
  });
});
