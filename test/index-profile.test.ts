import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ai: null as unknown,
  vectorize: null as unknown,
  recorded: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/cf/env", () => ({
  getAi: async () => state.ai,
  getVectorize: async () => state.vectorize,
}));
vi.mock("@/lib/costs/ledger", () => ({
  recordCost: async (input: Record<string, unknown>) => {
    state.recorded.push(input);
    return true;
  },
}));
vi.mock("@/lib/costs/prices", () => ({
  getUnitCost: async () => 0.0118,
}));

import { indexProfile, profileTexts } from "@/lib/embeddings/index-profile";
import type { MonitoringProfileInput } from "@/lib/profile/types";
import { createFakeAi } from "./helpers/fake-ai";
import { createFakeVectorize } from "./helpers/fake-vectorize";

const WORKSPACE = "ws-1";
const MAX_PROFILE_VECTORS = 64;

const profile: MonitoringProfileInput = {
  productUrl: "https://example.com",
  docsUrls: [],
  productDescription: "  Invoice reminders for freelancers  ",
  targetCustomer: "Solo consultants",
  competitors: ["Bill.com", "   ", "FreshBooks"],
  topics: ["late payments", "", "invoice follow-up"],
};

beforeEach(() => {
  state.ai = null;
  state.vectorize = null;
  state.recorded = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("profileTexts", () => {
  it("returns description, customer, topics and alternative-to lines, dropping blanks", () => {
    expect(profileTexts(profile)).toEqual([
      "Invoice reminders for freelancers",
      "Solo consultants",
      "late payments",
      "invoice follow-up",
      "alternative to Bill.com",
      "alternative to FreshBooks",
    ]);
  });

  it("drops blank product fields rather than emitting empty texts", () => {
    expect(
      profileTexts({ ...profile, productDescription: " ", targetCustomer: "", topics: [], competitors: [] }),
    ).toEqual([]);
  });
});

describe("indexProfile", () => {
  it("upserts one profile vector per text with ids profile:<profileId>:<n>", async () => {
    const ai = createFakeAi();
    const vz = createFakeVectorize();
    state.ai = ai.binding;
    state.vectorize = vz.binding;

    const result = await indexProfile(WORKSPACE, "prof-1", 1, profile);

    expect(result).toEqual({ indexed: 6 });
    const upsert = vz.calls.find((c) => c.op === "upsert");
    expect(upsert?.op === "upsert" && upsert.vectors.map((v) => v.id)).toEqual(
      ["profile:prof-1:0", "profile:prof-1:1", "profile:prof-1:2", "profile:prof-1:3", "profile:prof-1:4", "profile:prof-1:5"],
    );
    expect(vz.store.get("profile:prof-1:0")?.metadata).toEqual({ kind: "profile" });
    expect(vz.store.get("profile:prof-1:0")?.namespace).toBe(WORKSPACE);
    expect(ai.calls).toHaveLength(1);
  });

  it("deletes the previous version's vector ids before upserting", async () => {
    state.ai = createFakeAi().binding;
    const vz = createFakeVectorize();
    state.vectorize = vz.binding;

    await indexProfile(WORKSPACE, "prof-2", 2, profile, "prof-1");

    const deleteIndex = vz.calls.findIndex((c) => c.op === "deleteByIds");
    const upsertIndex = vz.calls.findIndex((c) => c.op === "upsert");
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(deleteIndex).toBeLessThan(upsertIndex);
    const deleted = vz.calls[deleteIndex];
    expect(deleted.op === "deleteByIds" && deleted.ids).toEqual(
      Array.from({ length: MAX_PROFILE_VECTORS }, (_, i) => `profile:prof-1:${i}`),
    );
  });

  it("deletes the current profile's ids when no previous version is given", async () => {
    state.ai = createFakeAi().binding;
    const vz = createFakeVectorize();
    state.vectorize = vz.binding;

    await indexProfile(WORKSPACE, "prof-1", 1, profile);

    const deleted = vz.calls.find((c) => c.op === "deleteByIds");
    expect(deleted?.op === "deleteByIds" && deleted.ids[0]).toBe("profile:prof-1:0");
    expect(deleted?.op === "deleteByIds" && deleted.ids).toHaveLength(MAX_PROFILE_VECTORS);
  });

  it("returns skipped unavailable and touches nothing when the AI binding is absent", async () => {
    const vz = createFakeVectorize();
    state.vectorize = vz.binding;

    const result = await indexProfile(WORKSPACE, "prof-1", 1, profile);

    expect(result).toEqual({ indexed: 0, skipped: "unavailable" });
    expect(vz.calls).toHaveLength(0);
  });

  it("returns skipped unavailable when the Vectorize binding is absent", async () => {
    state.ai = createFakeAi().binding;

    const result = await indexProfile(WORKSPACE, "prof-1", 1, profile);

    expect(result).toEqual({ indexed: 0, skipped: "unavailable" });
  });
});
