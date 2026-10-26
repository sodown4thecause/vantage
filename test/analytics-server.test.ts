import { describe, expect, it, vi } from "vitest";

import { isReplayExcludedPath } from "@/lib/analytics/config";
import { captureServerException, type ServerAnalyticsDeps } from "@/lib/analytics/server";

function deps(over: Partial<ServerAnalyticsDeps> = {}): ServerAnalyticsDeps {
  return {
    key: () => "phc_test",
    host: () => "https://us.i.posthog.com",
    fetch: vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    waitUntil: async () => null,
    ...over,
  };
}

describe("captureServerException", () => {
  it("sends the class name and ids but never the message or stack", async () => {
    const d = deps();
    const error = new TypeError("secret doc text token=abc");
    await captureServerException(error, { workspaceId: "w1", sourceId: "s1", area: "collect" }, d);
    const [url, init] = vi.mocked(d.fetch).mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = String((init as RequestInit).body);
    expect(body).not.toContain("secret");
    expect(body).not.toContain("token=abc");
    const parsed = JSON.parse(body);
    expect(parsed.event).toBe("$exception");
    expect(parsed.properties.workspaceId).toBe("w1");
    expect(parsed.properties.$exception_list[0].type).toBe("TypeError");
  });

  it("does nothing without a key and never throws", async () => {
    const d = deps({ key: () => undefined });
    await captureServerException(new Error("x"), { workspaceId: "w", area: "a" }, d);
    expect(d.fetch).not.toHaveBeenCalled();
    const failing = deps({ fetch: (async () => { throw new Error("net"); }) as unknown as typeof fetch });
    await expect(captureServerException(new Error("x"), { workspaceId: "w", area: "a" }, failing)).resolves.toBeUndefined();
  });

  it("hands delivery to waitUntil when available", async () => {
    const waitUntil = vi.fn();
    await captureServerException(new Error("x"), { workspaceId: "w", area: "a" }, deps({ waitUntil: async () => waitUntil }));
    expect(waitUntil).toHaveBeenCalledOnce();
  });
});

describe("isReplayExcludedPath", () => {
  it("excludes auth pages only", () => {
    expect(isReplayExcludedPath("/auth/sign-in")).toBe(true);
    expect(isReplayExcludedPath("/authors")).toBe(false);
    expect(isReplayExcludedPath("/queue")).toBe(false);
  });
});
