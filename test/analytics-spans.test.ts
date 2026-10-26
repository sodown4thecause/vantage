import { describe, expect, it, vi } from "vitest";

const { getRequestContext } = vi.hoisted(() => ({ getRequestContext: vi.fn() }));
vi.mock("@/lib/cf/env", () => ({ getCloudflareRequestContext: getRequestContext }));

import { withObservedSpan } from "@/lib/analytics/spans.mjs";
import { withObservedSpan as withWorkerObservedSpan } from "@/worker/observability.mjs";

type FakeTracing = NonNullable<Parameters<typeof withObservedSpan>[3]>;

function fakeTracing(attributes: Record<string, unknown>): FakeTracing {
  return {
    enterSpan: async <T>(_name: string, callback: (span: { setAttribute: (key: string, value: unknown) => void; setAttributes: (values: Record<string, unknown>) => void }) => T) =>
      callback({
        setAttributes: (values) => Object.assign(attributes, values),
        setAttribute: (key, value) => { attributes[key] = value; },
      }),
  } as FakeTracing;
}

describe("allowlisted Cloudflare spans", () => {
  it("records only safe workspace/source/provider, status and duration attributes", async () => {
    const attributes: Record<string, unknown> = {};
    const result = await withObservedSpan(
      "provider.firecrawl",
      { workspaceId: "11111111-1111-4111-8111-111111111111", source: "web-search", provider: "firecrawl" },
      async () => "ok",
      fakeTracing(attributes),
    );
    expect(result).toBe("ok");
    expect(attributes).toMatchObject({
      workspaceId: "11111111-1111-4111-8111-111111111111",
      source: "web-search",
      provider: "firecrawl",
      status: "ok",
    });
    expect(typeof attributes.durationMs).toBe("number");
    expect(Object.keys(attributes).sort()).toEqual(["durationMs", "provider", "source", "status", "workspaceId"]);
  });

  it("resolves the runtime tracer afresh for each request", async () => {
    const secondAttributes: Record<string, unknown> = {};
    getRequestContext
      .mockResolvedValueOnce({ tracing: null })
      .mockResolvedValueOnce({ tracing: fakeTracing(secondAttributes) });
    await withObservedSpan("request.first", {}, async () => "first");
    await withObservedSpan("request.second", { workspaceId: "workspace-2" }, async () => "second");
    expect(getRequestContext).toHaveBeenCalledTimes(2);
    expect(secondAttributes).toMatchObject({ workspaceId: "workspace-2", status: "ok" });
  });

  it("emits ScanWorkspace steps through a Worker-owned span module", async () => {
    const attributes: Record<string, unknown> = {};
    const result = await withWorkerObservedSpan(
      "ScanWorkspace.collect",
      { workspaceId: "workspace-123", source: "collect", provider: "cloudflare_workflow" },
      async () => ({ status: "ok" }),
      fakeTracing(attributes),
      (value: { status: string }) => value.status,
    );
    expect(result).toEqual({ status: "ok" });
    expect(attributes).toMatchObject({
      workspaceId: "workspace-123",
      source: "collect",
      provider: "cloudflare_workflow",
      status: "ok",
    });
    expect(Object.keys(attributes).sort()).toEqual(["durationMs", "provider", "source", "status", "workspaceId"]);
  });

  it("drops URL/email-like attributes and never attaches thrown request content", async () => {
    const attributes: Record<string, unknown> = {};
    const tracing = fakeTracing(attributes);
    await expect(withObservedSpan(
      "source.fetch",
      { workspaceId: "alice@example.com", source: "https://secret.example/token", provider: "algolia" },
      async () => { throw new Error("private prompt and tokenized URL"); },
      tracing,
    )).rejects.toThrow("private prompt");
    expect(Object.keys(attributes).sort()).toEqual(["durationMs", "provider", "status"]);
    expect(attributes).toMatchObject({ provider: "algolia", status: "error" });
    expect(JSON.stringify(attributes)).not.toContain("alice");
    expect(JSON.stringify(attributes)).not.toContain("secret");
  });
});
