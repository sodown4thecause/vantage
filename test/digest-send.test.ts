import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetchImpl: null as null | ((url: string, init?: RequestInit) => Promise<Response>),
}));

vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
  if (!state.fetchImpl) throw new Error("fetch not expected");
  return state.fetchImpl(String(url), init);
});

import { renderDigestEmail, sendDigestEmail } from "@/lib/digest/send";

const opportunities = [
  {
    leadId: "lead-1",
    score: 91.5,
    intentRung: 3,
    reason: 'asks for a <cheaper> "tracking" tool',
    platform: "reddit",
    title: "Looking for an alternative to Brandwatch",
    url: "https://reddit.com/r/saas/comments/abc",
  },
  {
    leadId: "lead-2",
    score: 77,
    intentRung: 2,
    reason: null,
    platform: "hn",
    title: null,
    url: "https://news.ycombinator.com/item?id=1",
  },
];

afterEach(() => {
  state.fetchImpl = null;
});

describe("renderDigestEmail", () => {
  it("escapes third-party content and lists every opportunity", () => {
    const { subject, html, text } = renderDigestEmail(
      opportunities,
      "https://contextfor.dev/settings/digest?workspaceId=w1",
    );

    expect(subject).toBe("Vantage: 2 conversations worth joining today");
    expect(html).toContain("Looking for an alternative to Brandwatch");
    expect(html).not.toContain("<cheaper>");
    expect(html).toContain("&lt;cheaper&gt;");
    expect(text).toContain("https://reddit.com/r/saas/comments/abc");
    expect(text).toContain("Manage digest settings");
  });

  it("uses a singular subject for one opportunity", () => {
    const { subject } = renderDigestEmail(
      [opportunities[0]!],
      "https://contextfor.dev/settings/digest?workspaceId=w1",
    );
    expect(subject).toBe("Vantage: 1 conversation worth joining today");
  });
});

describe("sendDigestEmail", () => {
  const base = {
    to: "founder@example.com",
    workspaceId: "workspace-1",
    manageUrl: "https://contextfor.dev/settings/digest?workspaceId=workspace-1",
  };

  it("skips when there is nothing to send", async () => {
    const result = await sendDigestEmail({
      ...base,
      opportunities: [],
      apiKey: "re_test",
    });
    expect(result).toEqual({
      ok: true,
      skipped: true,
      reason: "no opportunities",
    });
  });

  it("skips when no API key is configured", async () => {
    const result = await sendDigestEmail({
      ...base,
      opportunities,
      apiKey: undefined,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.skipped) {
      expect(result.reason).toBe("no api key");
    }
  });

  it("posts the digest to Resend with the bearer key", async () => {
    const captured: {
      value: { url: string; init?: RequestInit } | null;
    } = { value: null };
    state.fetchImpl = async (url, init) => {
      captured.value = { url, init };
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    };

    const result = await sendDigestEmail({
      ...base,
      opportunities,
      apiKey: "re_test_key",
    });

    expect(result).toEqual({ ok: true });
    expect(captured.value?.url).toBe("https://api.resend.com/emails");
    const headers = (captured.value?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(String(captured.value?.init?.body));
    expect(body.to).toEqual(["founder@example.com"]);
    expect(body.subject).toContain("Vantage");
    expect(body.html).toContain("Brandwatch");
  });

  it("reports provider rejections without leaking the response", async () => {
    state.fetchImpl = async () =>
      new Response("invalid api key re_test_key", { status: 401 });

    const result = await sendDigestEmail({
      ...base,
      opportunities,
      apiKey: "re_test_key",
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe(
      "email provider rejected the digest",
    );
  });

  it("reports network failures", async () => {
    state.fetchImpl = async () => {
      throw new Error("network down");
    };
    const result = await sendDigestEmail({
      ...base,
      opportunities,
      apiKey: "re_test_key",
    });
    expect(result.ok).toBe(false);
  });
});
