import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DraftInput } from "@/lib/drafting/generate";
const mocks = vi.hoisted(() => ({ http: vi.fn(), calls: [] as Array<{ model: string; cost: number | undefined }> }));
vi.mock("@/lib/http/public-fetch", async original => ({ ...await original<typeof import("@/lib/http/public-fetch")>(), fetchPublicText: mocks.http }));
vi.mock("@/lib/providers/paid-call", async original => ({ ...await original<typeof import("@/lib/providers/paid-call")>(), runPaidCall: async (_meta: unknown, work: () => Promise<{ value: string; costUsd?: number }>) => {
  const result = await work(); mocks.calls[mocks.calls.length - 1].cost = result.costUsd; return result.value;
} }));
import { generateContribution, resolveModelEndpoint } from "@/lib/drafting/contribution";
const input: DraftInput = { productDescription: "tool", targetCustomer: "AI developers", productMaterialText: "", opportunityTitle: "Evaluate a coding agent", opportunitySummary: "Need a repeatable evaluation", recommendedAction: "Contribute a method",
  evidence: [{ documentId: "e1", title: "Question", urlCanonical: "https://github.com/example/tool/issues/1", platform: "github", contentMd: "Need a reproducible local evaluation with hidden tests." }] };
const candidate = { decision: "draft", text: "Use a reproducible local evaluation with hidden tests. Keep hidden tests separate from the local evaluation context.", angle: "Prevent leakage", gap: "Hidden test isolation", claims: [
  { sentence: "Use a reproducible local evaluation with hidden tests.", documentId: "e1", quote: "reproducible local evaluation with hidden tests" },
  { sentence: "Keep hidden tests separate from the local evaluation context.", documentId: "e1", quote: "local evaluation with hidden tests" },
] };
const response = (content: unknown) => ({ response: { ok: true }, text: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 100 } } }) });
beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-key"); vi.stubEnv("INCO_API_KEY", "test-key");
  vi.stubEnv("INCO_TRIAGE_ENABLED", "false"); vi.stubEnv("COMMENT_DRAFT_MODEL", "openai/gpt-6.1-sol");
  vi.stubEnv("CF_AIG_BASE_URL", ""); vi.stubEnv("CF_AIG_TOKEN", "");
  mocks.calls = []; mocks.http.mockReset().mockImplementation(async (_url, init) => { mocks.calls.push({ model: JSON.parse(init.body).model, cost: undefined }); return response(candidate); });
});
afterEach(() => vi.unstubAllEnvs());
it("checks venue restrictions and rules before any model call", async () => {
  const hn = { ...input, evidence: [{ ...input.evidence[0], platform: "hn" }] };
  expect((await generateContribution(hn, { workspaceId: "ws", rulesReviewed: true })).quality?.kind).toBe("brief");
  expect((await generateContribution(input, { workspaceId: "ws" })).quality?.kind).toBe("brief");
  expect(mocks.http).not.toHaveBeenCalled();
});
it("keeps indexed discovery snippets as research briefs", async () => {
  expect((await generateContribution({ ...input, evidence: [{ ...input.evidence[0], discoveryOnly: true }] }, { workspaceId: "ws", rulesReviewed: true })).quality?.kind).toBe("brief");
  expect(mocks.http).not.toHaveBeenCalled();
});
it("uses DeepSeek triage before Sol and accounts for cached input", async () => {
  vi.stubEnv("INCO_TRIAGE_ENABLED", "true");
  mocks.http.mockImplementationOnce(async (_url, init) => { mocks.calls.push({ model: JSON.parse(init.body).model, cost: undefined }); return response({ decision: "continue" }); });
  const result = await generateContribution(input, { workspaceId: "ws", rulesReviewed: true });
  expect(result.quality).toMatchObject({ kind: "draft", model: "openai/gpt-6.1-sol", rulesReviewed: true });
  expect(mocks.calls.map(c => c.model)).toEqual(["deepseek-v4.1-flash", "openai/gpt-6.1-sol"]);
  expect(mocks.calls[0].cost).toBeCloseTo(0.0003906);
  expect(mocks.calls[1].cost).toBeCloseTo(0.003);
});
it("avoids the premium call when cheap triage abstains", async () => {
  vi.stubEnv("INCO_TRIAGE_ENABLED", "true");
  mocks.http.mockImplementation(async (_url, init) => { mocks.calls.push({ model: JSON.parse(init.body).model, cost: undefined }); return response({ decision: "abstain", reason: "An announcement without an actionable question." }); });
  expect((await generateContribution(input, { workspaceId: "ws", rulesReviewed: true })).quality?.kind).toBe("abstain");
  expect(mocks.http).toHaveBeenCalledTimes(1);
});
it("records paid usage before rejecting an invented citation", async () => {
  mocks.http.mockImplementation(async (_url, init) => { mocks.calls.push({ model: JSON.parse(init.body).model, cost: undefined }); return response({ ...candidate, claims: [{ ...candidate.claims[0], documentId: "foreign" }] }); });
  const result = await generateContribution(input, { workspaceId: "ws", rulesReviewed: true });
  expect(result.quality?.kind).toBe("brief");
  expect(result.quality?.notes).toContain("Claim references unknown evidence.");
  expect(mocks.calls[0].cost).toBeCloseTo(0.003);
});
it("explains HTTP availability failures without exposing provider details", async () => {
  mocks.http.mockResolvedValue({ response: { ok: false, status: 503 }, text: "private provider token" });
  const result = await generateContribution(input, { workspaceId: "ws", rulesReviewed: true });
  expect(result.originalText).toContain("HTTP 503");
  expect(result.originalText).not.toContain("private provider token");
});
it("keeps arbitrary provider exceptions private", async () => {
  mocks.http.mockRejectedValue(new Error("private provider token"));
  const result = await generateContribution(input, { workspaceId: "ws", rulesReviewed: true });
  expect(result.quality?.kind).toBe("brief");
  expect(result.originalText).not.toContain("private provider token");
});
const GATEWAY = "https://gateway.ai.cloudflare.com/v1/account/gateway/compat";
const resolve = (vars: Record<string, string>) => resolveModelEndpoint(vars as NodeJS.ProcessEnv);
it("keeps today's AI Gateway endpoint and key when CF_AIG_BASE_URL is unset or blank", () => {
  const today = { url: "https://ai-gateway.vercel.sh/v1/chat/completions", key: "vercel-key" };
  expect(resolve({ AI_GATEWAY_API_KEY: "vercel-key", CF_AIG_TOKEN: "cf-token" })).toEqual(today);
  expect(resolve({ AI_GATEWAY_API_KEY: "vercel-key", CF_AIG_BASE_URL: "   ", CF_AIG_TOKEN: "cf-token" })).toEqual(today);
  expect(resolve({})).toEqual({ url: today.url, key: undefined });
});
it("routes draft models through Cloudflare AI Gateway with CF_AIG_TOKEN when CF_AIG_BASE_URL is set", () => {
  expect(resolve({ CF_AIG_BASE_URL: GATEWAY, CF_AIG_TOKEN: "cf-token", AI_GATEWAY_API_KEY: "vercel-key" })).toEqual({ url: `${GATEWAY}/chat/completions`, key: "cf-token" });
  expect(resolve({ CF_AIG_BASE_URL: `${GATEWAY}/`, CF_AIG_TOKEN: "cf-token" }).url).toBe(`${GATEWAY}/chat/completions`);
  expect(resolve({ CF_AIG_BASE_URL: GATEWAY, AI_GATEWAY_API_KEY: "vercel-key" }).key).toBeUndefined();
});
it("sends draft requests to the gateway with unchanged model names and the gateway token", async () => {
  vi.stubEnv("CF_AIG_BASE_URL", GATEWAY); vi.stubEnv("CF_AIG_TOKEN", "cf-token");
  const result = await generateContribution(input, { workspaceId: "ws", rulesReviewed: true });
  expect(result.quality).toMatchObject({ kind: "draft", model: "openai/gpt-6.1-sol" });
  expect(mocks.http).toHaveBeenCalledTimes(1);
  const [url, init] = mocks.http.mock.calls[0];
  expect(url).toBe(`${GATEWAY}/chat/completions`);
  expect(init.headers.authorization).toBe("Bearer cf-token");
  expect(JSON.parse(init.body).model).toBe("openai/gpt-6.1-sol");
});
it("keeps DeepSeek triage on Inco when draft routing goes through the gateway", async () => {
  vi.stubEnv("CF_AIG_BASE_URL", GATEWAY); vi.stubEnv("CF_AIG_TOKEN", "cf-token"); vi.stubEnv("INCO_TRIAGE_ENABLED", "true");
  mocks.http.mockImplementationOnce(async (_url, init) => { mocks.calls.push({ model: JSON.parse(init.body).model, cost: undefined }); return response({ decision: "continue" }); });
  await generateContribution(input, { workspaceId: "ws", rulesReviewed: true });
  expect(mocks.http.mock.calls.map(call => call[0])).toEqual(["https://api.inco.ai/v1/chat/completions", `${GATEWAY}/chat/completions`]);
});
it("reports access pending without calling the provider when the gateway URL has no token", async () => {
  vi.stubEnv("CF_AIG_BASE_URL", GATEWAY);
  const result = await generateContribution(input, { workspaceId: "ws", rulesReviewed: true });
  expect(result.quality?.kind).toBe("brief");
  expect(result.originalText).toContain("AI Gateway access is pending.");
  expect(mocks.http).not.toHaveBeenCalled();
});
it("still rejects models outside the verified allow-list when routed through the gateway", async () => {
  vi.stubEnv("CF_AIG_BASE_URL", GATEWAY); vi.stubEnv("CF_AIG_TOKEN", "cf-token"); vi.stubEnv("COMMENT_DRAFT_MODEL", "unverified/model");
  const result = await generateContribution(input, { workspaceId: "ws", rulesReviewed: true });
  expect(result.quality?.kind).toBe("brief");
  expect(result.originalText).toContain("Choose a verified comment model.");
  expect(mocks.http).not.toHaveBeenCalled();
});
