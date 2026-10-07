import { afterEach, expect, it, vi } from "vitest";
import { substackCollector } from "@/lib/collectors/substack";

afterEach(() => vi.unstubAllGlobals());
const ctx = { workspaceId: "workspace", sourceId: "source", config: { feedUrl: "https://publication.substack.com/feed" } };
const xml = (length: number) => `<rss><channel><item><title>Public AI research</title><link>https://publication.substack.com/p/research</link><description>${"x".repeat(length)}</description></item></channel></rss>`;

it("allows large public Substack feeds only with an explicit bounded response size", async () => {
  vi.stubGlobal("fetch", async () => new Response(xml(700_000)));
  await expect(substackCollector.run(ctx)).rejects.toThrow("Response exceeds size limit");
  const result = await substackCollector.run({ ...ctx, config: { ...ctx.config, maxResponseBytes: 900_000 } });
  expect(result.documents).toHaveLength(1);
  expect(result.documents[0]?.contentMd).toHaveLength(700_000);
});

it("enforces the three-megabyte ceiling even when a source asks for more", async () => {
  vi.stubGlobal("fetch", async () => new Response(xml(3_000_001)));
  await expect(substackCollector.run({ ...ctx, config: { ...ctx.config, maxResponseBytes: 10_000_000 } })).rejects.toThrow("Response exceeds size limit");
});
