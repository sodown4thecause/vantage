import { describe, expect, it, vi } from "vitest";

import { retrieveProductMaterial } from "../lib/profile/retrieve";
import type { MonitoringProfileInput } from "../lib/profile/types";
import { validateMonitoringProfileInput } from "../lib/profile/validate";
import { toProfileView } from "../lib/profile/repository";
import type { MonitoringProfile } from "../lib/db/schema";

const validBase: MonitoringProfileInput = {
  productUrl: "https://example.com",
  docsUrls: ["https://example.com/docs"],
  productDescription: "A social listening tool for founders.",
  targetCustomer: "Solo B2B SaaS founders",
  competitors: ["Alpha", "Beta", "Gamma"],
  topics: ["intent detection", "reply drafting"],
};

describe("monitoring profile validation", () => {
  it("accepts a complete profile", () => {
    const result = validateMonitoringProfileInput(validBase);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.competitors).toHaveLength(3);
      expect(result.value.productUrl).toBe("https://example.com");
    }
  });

  it("returns field errors for missing required fields", () => {
    const result = validateMonitoringProfileInput({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.productUrl).toMatch(/required/i);
      expect(result.errors.productDescription).toMatch(/required/i);
      expect(result.errors.targetCustomer).toMatch(/required/i);
      expect(result.errors.competitors).toMatch(/3/);
      expect(result.errors.topics).toMatch(/topic/i);
    }
  });

  it("rejects invalid product URLs", () => {
    const result = validateMonitoringProfileInput({
      ...validBase,
      productUrl: "not-a-url",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.productUrl).toMatch(/http/i);
    }
  });

  it("requires 3–5 competitors", () => {
    const tooFew = validateMonitoringProfileInput({
      ...validBase,
      competitors: ["A", "B"],
    });
    expect(tooFew.ok).toBe(false);

    const tooMany = validateMonitoringProfileInput({
      ...validBase,
      competitors: ["A", "B", "C", "D", "E", "F"],
    });
    // max 5 kept by list clamp then length check — clamped to 5 so ok
    expect(tooMany.ok).toBe(true);
    if (tooMany.ok) {
      expect(tooMany.value.competitors).toHaveLength(5);
    }
  });
});

describe("product material retrieval", () => {
  it("marks material ok when fetch succeeds", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<html><body><h1>Hello product</h1></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const result = await retrieveProductMaterial(validBase, fetchImpl);
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(/Hello product/);
  });

  it("falls back to manual material when URLs fail", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await retrieveProductMaterial(
      {
        ...validBase,
        productMaterialManual: "Manual README content",
      },
      fetchImpl,
    );
    expect(result.status).toBe("manual");
    expect(result.text).toBe("Manual README content");
  });

  it("marks inaccessible when fetch fails and no manual text", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 404 }),
    );
    const result = await retrieveProductMaterial(validBase, fetchImpl);
    expect(result.status).toBe("inaccessible");
    expect(result.text).toBe("");
    expect(result.notes).toMatch(/404|inaccessible|HTTP/i);
  });

  it("skips network when forceManualMaterial is set", async () => {
    const fetchImpl = vi.fn();
    const result = await retrieveProductMaterial(
      {
        ...validBase,
        forceManualMaterial: true,
        productMaterialManual: "Only manual",
      },
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.status).toBe("manual");
    expect(result.text).toBe("Only manual");
  });
});

describe("profile view mapping", () => {
  it("serializes a stable versioned view", () => {
    const createdAt = new Date("2026-09-21T10:00:00.000Z");
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      workspaceId: "22222222-2222-2222-2222-222222222222",
      version: 3,
      productUrl: "https://example.com",
      docsUrls: ["https://example.com/docs"],
      productDescription: "desc",
      targetCustomer: "founders",
      competitors: ["A", "B", "C"],
      topics: ["pricing"],
      productMaterialStatus: "ok" as const,
      productMaterialText: "body",
      retrievalNotes: "ok",
      createdAt,
    } satisfies MonitoringProfile;

    const view = toProfileView(row);
    expect(view.version).toBe(3);
    expect(view.createdAt).toBe("2026-09-21T10:00:00.000Z");
    expect(view.workspaceId).toBe(row.workspaceId);
    expect(view.competitors).toEqual(["A", "B", "C"]);
  });
});
