import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetchImpl: null as null | ((url: string, init?: RequestInit) => Promise<Response>),
  // Digest delivery resolves the workspace permission row before the provider
  // call; stub the database so the stalled fetch below is the provider call,
  // not the database query behind it.
  workspaceRows: [] as Array<{ id: string }>,
}));

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.workspaceRows,
        }),
      }),
    }),
  }),
}));

import { renderDigestEmail, sendDigestEmail } from "@/lib/digest/send";

const opportunities = [
  {
    opportunityId: "opportunity-1",
    score: 91.5,
    reason: 'asks for a <cheaper> "tracking" tool',
    platform: "reddit",
    title: "Looking for an alternative to Brandwatch",
    url: "https://reddit.com/r/saas/comments/abc",
  },
  {
    opportunityId: "opportunity-2",
    score: 77,
    reason: null,
    platform: "hn",
    title: null,
    url: "https://news.ycombinator.com/item?id=1",
  },
];

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  // The unsubscribe token is HMAC-signed with CRON_SECRET; without it the send
  // fails before the provider call and this suite would assert nothing.
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  state.workspaceRows = [{ id: "workspace-1" }];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (!state.fetchImpl) throw new Error("fetch not expected");
    return state.fetchImpl(String(url), init);
  });
});

afterEach(() => {
  state.fetchImpl = null;
  state.workspaceRows = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("renderDigestEmail", () => {
  it("escapes third-party content and lists every opportunity", () => {
    const { html, text } = renderDigestEmail(
      opportunities,
      "https://contextfor.dev/settings/digest?workspaceId=w1",
    );

    expect(html).toContain("Looking for an alternative to Brandwatch");
    expect(html).not.toContain("<cheaper>");
    expect(html).toContain("&lt;cheaper&gt;");
    expect(text).toContain("https://reddit.com/r/saas/comments/abc");
    expect(text).toContain(opportunities[1]!.url);
  });

  it.each([
    'javascript:alert("private")',
    "data:text/html,<script>alert('private')</script>",
    "file:///etc/private",
  ])("renders %s destinations without emitting an unsafe URI", (url) => {
    const { html, text } = renderDigestEmail(
      [{ ...opportunities[0]!, title: "Unsafe <conversation>", url }],
      "https://contextfor.dev/settings/digest?workspaceId=w1",
    );

    expect(html).toContain("1. Unsafe &lt;conversation&gt;");
    expect(html).not.toContain(`<a href="${url}`);
    expect(html).not.toContain(url);
    expect(text).toContain("1. Unsafe <conversation>");
    expect(text).not.toContain(url);
  });

  it("does not fall back to an unsafe URL when the title is missing", () => {
    const url = "javascript:alert('private')";
    const { html, text } = renderDigestEmail(
      [{ ...opportunities[0]!, title: null, url }],
      "https://contextfor.dev/settings/digest?workspaceId=w1",
    );

    expect(html).toContain("1. Conversation");
    expect(html).not.toContain(url);
    expect(text).toContain("1. Conversation");
    expect(text).not.toContain(url);
  });

  it("retains safe HTTPS destinations in both email bodies", () => {
    const url = "https://example.com/conversation?first=1&second=2";
    const { html, text } = renderDigestEmail(
      [{ ...opportunities[0]!, url }],
      "https://contextfor.dev/settings/digest?workspaceId=w1",
    );

    expect(html).toContain(
      'href="https://example.com/conversation?first=1&amp;second=2"',
    );
    expect(text).toContain(url);
  });

});

describe("sendDigestEmail", () => {
  const base = {
    to: "founder@example.com",
    workspaceId: "workspace-1",
    previousDigestLastSentAt: null,
    manageUrl: "https://contextfor.dev/settings/digest?workspaceId=workspace-1",
  };

  it("skips when there is nothing to send", async () => {
    const result = await sendDigestEmail({
      ...base,
      opportunities: [],
      apiKey: "re_test",
    });
    expect(result).toMatchObject({ ok: true, skipped: true });
  });

  it("skips when no API key is configured", async () => {
    const result = await sendDigestEmail({
      ...base,
      opportunities,
      apiKey: undefined,
    });
    expect(result).toMatchObject({ ok: true, skipped: true });
  });

  it("aborts a stalled provider call within the configured timeout without logging credentials", async () => {
    // The send's tracing span loads this with a real dynamic import before it creates the
    // timeout. Load it now, under real timers, so a busy machine can't delay it past the clock.
    await import("@opennextjs/cloudflare");
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let providerCalled!: () => void;
    const providerCall = new Promise<void>((resolve) => { providerCalled = resolve; });
    state.fetchImpl = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      providerCalled();
    });
    // Use a timer-backed signal so fake timers exercise the same abort contract.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((timeout) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeout);
      return controller.signal;
    });
    try {
      const sending = sendDigestEmail({ ...base, opportunities, apiKey: "re_test_key" });
      // Advance only once the timeout exists: it is created with the provider request.
      await providerCall;
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await sending).ok).toBe(false);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(/re_test_key|founder@example\.com/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports provider rejections without leaking the response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.fetchImpl = async () =>
      new Response("invalid api key re_test_key", { status: 401 });

    const result = await sendDigestEmail({
      ...base,
      opportunities,
      apiKey: "re_test_key",
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(
      /re_test_key|founder@example\.com|invalid api key/,
    );
  });

  it("reports network failures without logging exception payloads", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.fetchImpl = async () => {
      throw new Error("private network payload re_test_key founder@example.com");
    };
    const result = await sendDigestEmail({
      ...base,
      opportunities,
      apiKey: "re_test_key",
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toMatch(
      /private network payload|re_test_key|founder@example\.com/,
    );
  });
});
