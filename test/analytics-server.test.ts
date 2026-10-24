import { afterEach, describe, expect, it, vi } from "vitest";

import { posthogAssetsHost, posthogHost, posthogUiHost } from "@/lib/analytics/config";
import { FunnelEvent } from "@/lib/analytics/events";
import { captureServerEvent, type ServerAnalyticsDeps } from "@/lib/analytics/server";

type FetchArgs = Parameters<typeof fetch>;

function fakeFetch(respond: () => Promise<Response> = async () => new Response(null, { status: 200 })) {
  return vi.fn<(...args: FetchArgs) => Promise<Response>>(respond);
}

function deps(overrides: Partial<ServerAnalyticsDeps> = {}): ServerAnalyticsDeps {
  return {
    key: () => "phc_test",
    host: () => "https://us.i.posthog.com",
    fetch: fakeFetch(),
    waitUntil: async () => null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
});

describe("captureServerEvent", () => {
  it("does nothing without a PostHog key", async () => {
    const fetch = fakeFetch();
    await captureServerEvent(FunnelEvent.SignedUp, "user_1", {}, deps({ key: () => undefined, fetch }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the event by user id and waits for delivery outside a Worker", async () => {
    const order: string[] = [];
    const fetch = fakeFetch(async () => { order.push("delivered"); return new Response(null, { status: 200 }); });
    await captureServerEvent(FunnelEvent.CheckoutStarted, "user_1", { plan: "pro_monthly" }, deps({ fetch }));
    order.push("returned");
    expect(order).toEqual(["delivered", "returned"]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      api_key: "phc_test",
      event: "checkout_started",
      distinct_id: "user_1",
      properties: { plan: "pro_monthly" },
    });
  });

  it("hands delivery to the Worker's waitUntil when there is one", async () => {
    let release!: (response: Response) => void;
    const fetch = fakeFetch(() => new Promise<Response>((resolve) => { release = resolve; }));
    const waitUntil = vi.fn();
    // Resolves even though delivery is still pending: the Worker keeps it alive.
    await captureServerEvent(FunnelEvent.SignedUp, "user_1", {}, deps({ fetch, waitUntil: async () => waitUntil }));
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    release(new Response(null, { status: 200 }));
  });

  it("never throws when the request fails or PostHog rejects it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(captureServerEvent(FunnelEvent.SignedUp, "user_1", {}, deps({
      fetch: fakeFetch(async () => { throw new Error("network"); }),
    }))).resolves.toBeUndefined();
    await expect(captureServerEvent(FunnelEvent.SignedUp, "user_1", {}, deps({
      fetch: fakeFetch(async () => new Response("bad", { status: 400 })),
    }))).resolves.toBeUndefined();
    await expect(captureServerEvent(FunnelEvent.SignedUp, "user_1", {}, deps({
      key: () => { throw new Error("boom"); },
    }))).resolves.toBeUndefined();
  });

  it("skips an empty distinct id rather than merging anonymous users", async () => {
    const fetch = fakeFetch();
    await captureServerEvent(FunnelEvent.SignedUp, "", {}, deps({ fetch }));
    expect(fetch).not.toHaveBeenCalled();
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
