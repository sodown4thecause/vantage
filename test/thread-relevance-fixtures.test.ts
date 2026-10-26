import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const nonempty = z.string().trim().min(1);
const caseSchema = z.object({
  id: nonempty.startsWith("synthetic-"),
  split: z.enum(["development", "acceptance"]),
  profile: z.object({
    domain: nonempty,
    audience: nonempty,
    expertise: z.array(nonempty).min(1),
    exclusions: z.array(nonempty).min(1),
  }).strict(),
  thread: z.object({
    platform: z.enum(["hn", "reddit"]),
    url: z.url().refine((value) => new URL(value).hostname === "example.com"),
    text: nonempty,
    replies: z.array(nonempty),
    contextState: z.enum(["complete", "preview", "deleted", "locked", "unavailable", "replies_unavailable"]),
  }).strict(),
  expected: z.enum(["recommend", "reject", "research_only"]),
  reason: nonempty.startsWith("Synthetic:"),
}).strict();

const fixturePath = fileURLToPath(new URL("./fixtures/thread-relevance.json", import.meta.url));
const readCases = () => z.array(caseSchema).min(1).parse(JSON.parse(readFileSync(fixturePath, "utf8")));

describe("labelled thread relevance fixtures", () => {
  it("supplies a nonempty corpus with the agreed schema and explicit synthetic provenance", () => {
    expect(existsSync(fixturePath), "labelled relevance corpus must exist").toBe(true);
    readCases();
  });

  it("keeps identities, URLs and actual thread content independent across splits", () => {
    const cases = readCases();
    for (const values of [
      cases.map((row) => row.id),
      cases.map((row) => row.thread.url),
      cases.map((row) => row.thread.text.toLowerCase().replace(/\W+/g, " ").trim()),
    ]) expect(new Set(values).size).toBe(values.length);
    const development = cases.filter((row) => row.split === "development");
    const acceptance = cases.filter((row) => row.split === "acceptance");
    const developmentReplies = new Set(development.flatMap((row) => row.thread.replies.map((reply) => reply.toLowerCase().replace(/\W+/g, " ").trim())));
    expect(acceptance.flatMap((row) => row.thread.replies).some((reply) => developmentReplies.has(reply.toLowerCase().replace(/\W+/g, " ").trim()))).toBe(false);
  });

  for (const split of ["development", "acceptance"] as const) {
    it(`${split} covers positives, hard negatives, policy and insufficient context`, () => {
      const cases = readCases().filter((row) => row.split === split);
      expect(new Set(cases.map((row) => row.expected))).toEqual(new Set(["recommend", "reject", "research_only"]));
      for (const state of ["preview", "deleted", "locked", "unavailable", "replies_unavailable"]) {
        const rows = cases.filter((row) => row.thread.contextState === state);
        expect(rows.length, `${split}: missing ${state}`).toBeGreaterThan(0);
        expect(rows.every((row) => row.expected !== "recommend")).toBe(true);
      }
      const question = cases.find((row) => row.expected === "recommend");
      expect(question?.thread.text).toContain("?");
      expect(question?.thread.text).not.toMatch(/\b(buy|purchase|pricing|subscribe|recommend|alternative)\b/i);
      for (const category of ["keyword-collision", "hostile-instructions", "already-answered"]) {
        const row = cases.find((candidate) => candidate.id.endsWith(category));
        expect(row?.expected, `${split}: missing hard negative ${category}`).toBe("reject");
        expect(row?.thread.contextState).toBe("complete");
        if (category === "already-answered") expect(row?.thread.replies.length).toBeGreaterThan(0);
        if (category === "hostile-instructions") expect(row?.thread.text).toMatch(/ignore .*instructions/i);
        if (category === "keyword-collision") {
          expect(row?.thread.platform).toBe("hn");
          const words = row!.profile.domain.toLowerCase().split(/\W+/);
          expect(words.some((word) => word.length > 3 && row!.thread.text.toLowerCase().includes(word))).toBe(true);
        }
      }
      expect(cases.some((row) => row.thread.platform === "hn" && row.thread.contextState === "complete" && row.expected === "research_only")).toBe(true);
    });
  }

  it("never labels HN as a reply recommendation or incomplete context as safe to reply", () => {
    for (const row of readCases()) {
      if (row.thread.platform === "hn") expect(row.expected).not.toBe("recommend");
      if (row.expected === "recommend") expect(row.thread.contextState).toBe("complete");
    }
  });
});
