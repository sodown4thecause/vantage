import { describe, expect, it, vi } from "vitest";

import { captureProductEvent, type ServerAnalyticsDeps } from "@/lib/analytics/server";

function analyticsDeps() {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const deps: ServerAnalyticsDeps = {
    key: () => "phc_public_project_token",
    host: () => "https://us.i.posthog.com",
    fetch: vi.fn(async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(null, { status: 200 });
    }) as typeof fetch,
    waitUntil: async () => null,
  };
  return { deps, requests };
}

async function eventPayload(request: { init: RequestInit }) {
  return JSON.parse(String(request.init.body)) as Record<string, unknown>;
}

describe("privacy-limited product analytics events", () => {
  it("sends scan_finished counts and a workspace-scoped identity without extra payload data", async () => {
    const { deps, requests } = analyticsDeps();
    await captureProductEvent({
      event: "scan_finished",
      workspaceId: "workspace-123",
      read: 42,
      relevant: 9,
      picked: 3,
      capped: true,
    }, deps);
    const payload = await eventPayload(requests[0]!);
    expect(requests[0]?.url).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(payload).toMatchObject({
      event: "scan_finished",
      distinct_id: "workspace:workspace-123",
      properties: {
        workspaceId: "workspace-123",
        read: 42,
        relevant: 9,
        picked: 3,
        capped: true,
        $process_person_profile: false,
      },
    });
    expect(Object.keys(payload.properties as object).sort()).toEqual([
      "$lib", "$process_person_profile", "capped", "picked", "read", "relevant", "workspaceId",
    ]);
  });

  it("keeps workspace event identity consistent while retaining only the requested outcome label", async () => {
    const { deps, requests } = analyticsDeps();
    await captureProductEvent({
      event: "outcome_marked",
      userId: "neon-user-123",
      workspaceId: "workspace-123",
      outcome: "replied",
    }, deps);
    const payload = await eventPayload(requests[0]!);
    expect(payload.distinct_id).toBe("workspace:workspace-123");
    expect(payload.properties).toMatchObject({ workspaceId: "workspace-123", outcome: "replied" });
    expect(JSON.stringify(payload)).not.toMatch(/email|url|content|prompt/i);
  });
});
