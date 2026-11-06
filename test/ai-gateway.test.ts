import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createGateway: vi.fn(),
  createOpenAICompatible: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  createGateway: mocks.createGateway,
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));

import {
  gatewayBackend,
  gatewayConfigured,
  gatewayRequestHeaders,
  gatewayResponseInfo,
} from "@/lib/ai/gateway-config";
import { gatewayFetch, gatewayModel } from "@/lib/ai/gateway";

const CLOUDFLARE = {
  AI_GATEWAY_PROVIDER: "cloudflare",
  CF_AIG_ACCOUNT_ID: "account",
  CF_AIG_GATEWAY_ID: "gateway",
  CF_AIG_TOKEN: "cf-token",
};

beforeEach(() => {
  mocks.createGateway.mockReset().mockReturnValue((id: string) => ({ id }));
  mocks.createOpenAICompatible.mockReset().mockReturnValue((id: string) => ({ id }));
});

describe("gateway backend selection", () => {
  it("defaults to vercel so production keeps today's behaviour", () => {
    expect(gatewayBackend({})).toBe("vercel");
    expect(gatewayBackend({ AI_GATEWAY_PROVIDER: "vercel" })).toBe("vercel");
    expect(gatewayBackend({ AI_GATEWAY_PROVIDER: " Cloudflare " })).toBe("cloudflare");
  });

  it("requires the credentials of the selected backend", () => {
    expect(gatewayConfigured({ AI_GATEWAY_API_KEY: "key" })).toBe(true);
    expect(gatewayConfigured({})).toBe(false);
    expect(gatewayConfigured(CLOUDFLARE)).toBe(true);
    expect(gatewayConfigured({ ...CLOUDFLARE, CF_AIG_TOKEN: "" })).toBe(false);
  });
});

describe("gateway request headers", () => {
  it("carries identifiers only and skips the cache by default", () => {
    const headers = gatewayRequestHeaders({
      feature: "seo.classify",
      workspaceId: "ws_1",
      scanRunId: "scan_1",
      chatId: "chat_1",
    });
    expect(JSON.parse(headers["cf-aig-metadata"])).toEqual({
      feature: "seo.classify",
      workspaceId: "ws_1",
      scanRunId: "scan_1",
      chatId: "chat_1",
    });
    expect(headers["cf-aig-skip-cache"]).toBe("true");
    expect(headers["cf-aig-cache-key"]).toBeUndefined();
  });

  it("caches only when the caller supplies a key", () => {
    const headers = gatewayRequestHeaders({
      feature: "seo.classify",
      cache: { key: "ws_1:classify", ttlSeconds: 300 },
    });
    expect(headers["cf-aig-cache-key"]).toBe("ws_1:classify");
    expect(headers["cf-aig-cache-ttl"]).toBe("300");
    expect(headers["cf-aig-skip-cache"]).toBeUndefined();
  });

  it("adds Auto Router limits and a session id only when asked", () => {
    const headers = gatewayRequestHeaders(
      { feature: "seo.execute", chatId: "chat_1", autoRouter: true },
      { CF_AIG_ALLOWED_MODELS: "anthropic/claude-sonnet-5.5,openai/gpt-6.1-sol" },
    );
    expect(headers["cf-aig-allowed-models"]).toBe("anthropic/claude-sonnet-5.5,openai/gpt-6.1-sol");
    expect(headers["cf-aig-session-id"]).toBe("chat_1");
  });
});

describe("gateway endpoints", () => {
  it("keeps the Vercel URLs and bearer token", () => {
    const env = { AI_GATEWAY_API_KEY: "vercel-key" };
    expect(gatewayFetch({ feature: "draft.contribution" }, env, "chat")).toEqual({
      url: "https://ai-gateway.vercel.sh/v1/chat/completions",
      headers: { Authorization: "Bearer vercel-key" },
    });
    expect(gatewayFetch({ feature: "x.significance" }, env, "responses").url)
      .toBe("https://ai-gateway.vercel.sh/v1/responses");
  });

  it("uses the Cloudflare compat endpoint and refuses the Responses API there", () => {
    const endpoint = gatewayFetch({ feature: "draft.contribution", workspaceId: "ws_1" }, CLOUDFLARE, "chat");
    expect(endpoint.url).toBe("https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions");
    expect(endpoint.headers.Authorization).toBe("Bearer cf-token");
    expect(() => gatewayFetch({ feature: "x.significance" }, CLOUDFLARE, "responses"))
      .toThrow("does not serve the Responses API");
  });
});

describe("gateway model", () => {
  it("builds the Vercel client with the API key", () => {
    expect(gatewayModel("anthropic/claude-sonnet-5.5", { feature: "seo.classify" }, { AI_GATEWAY_API_KEY: "vercel-key" }))
      .toEqual({ id: "anthropic/claude-sonnet-5.5" });
    expect(mocks.createGateway).toHaveBeenCalledWith({ apiKey: "vercel-key" });
  });

  it("builds the Cloudflare client with metadata headers", () => {
    expect(gatewayModel("anthropic/claude-sonnet-5.5", { feature: "seo.classify", workspaceId: "ws_1" }, CLOUDFLARE))
      .toEqual({ id: "anthropic/claude-sonnet-5.5" });
    const options = mocks.createOpenAICompatible.mock.calls[0][0];
    expect(options.baseURL).toBe("https://gateway.ai.cloudflare.com/v1/account/gateway/compat");
    expect(options.apiKey).toBe("cf-token");
    expect(JSON.parse(options.headers["cf-aig-metadata"])).toEqual({ feature: "seo.classify", workspaceId: "ws_1" });
  });

  it("asks Auto Router for cloudflare/auto and pins the session", () => {
    expect(gatewayModel("anthropic/claude-sonnet-5.5", { feature: "seo.execute", chatId: "chat_1", autoRouter: true }, CLOUDFLARE))
      .toEqual({ id: "cloudflare/auto" });
    expect(mocks.createOpenAICompatible.mock.calls[0][0].headers["cf-aig-session-id"]).toBe("chat_1");
  });

  it("fails clearly when the selected backend is not configured", () => {
    expect(() => gatewayModel("m", { feature: "seo.classify" }, {})).toThrow("AI_GATEWAY_API_KEY is not set");
    expect(() => gatewayModel("m", { feature: "seo.classify" }, { AI_GATEWAY_PROVIDER: "cloudflare" }))
      .toThrow("Cloudflare AI Gateway is not configured");
  });
});

describe("gateway response info", () => {
  it("reads the served model and request id from either header shape", () => {
    const headers = new Headers({ "cf-aig-routed-model": "openai/gpt-6.1-sol", "cf-aig-request-id": "req_1" });
    expect(gatewayResponseInfo(headers)).toEqual({ servedModel: "openai/gpt-6.1-sol", requestId: "req_1" });
    expect(gatewayResponseInfo({ "cf-aig-routed-model": "m", "cf-aig-request-id": "r" }))
      .toEqual({ servedModel: "m", requestId: "r" });
    expect(gatewayResponseInfo(undefined)).toEqual({ servedModel: null, requestId: null });
  });
});
