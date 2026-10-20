import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDataForSeo: vi.fn(),
  peekDataForSeo: vi.fn(),
  listLlmModels: vi.fn(),
}));
vi.mock("@/lib/dataforseo/gate", () => ({
  runDataForSeo: mocks.runDataForSeo,
  peekDataForSeo: mocks.peekDataForSeo,
  listLlmModels: mocks.listLlmModels,
}));

import { FRESHNESS_SECONDS } from "@/lib/dataforseo/cache";
import {
  LLM_ENGINES,
  aiKeywordVolumeTask,
  brandMentioned,
  fetchAiKeywordVolume,
  fetchLlmResponse,
  llmResponseTask,
  peekAiKeywordVolume,
  peekLlmResponse,
  resolveLlmModel,
  trimAiKeywordVolume,
  trimLlmResponse,
} from "@/lib/dataforseo/ai-optimization";

const llmResult = [{
  model_name: "gpt-4o-search",
  items: [
    {
      type: "message",
      sections: [
        {
          type: "text",
          text: "Pinecone is a vector database.",
          annotations: [
            { type: "citation", title: "Pinecone docs", url: "https://docs.pinecone.io/x" },
            { title: "no url" },
            { url: 5 },
          ],
        },
      ],
    },
    {
      type: "message",
      sections: [
        { type: "text", text: "Other options exist.", annotations: [] },
        { type: "text", text: 4 },
      ],
    },
  ],
}];

beforeEach(() => {
  mocks.runDataForSeo.mockReset().mockResolvedValue({ value: null, cached: false });
  mocks.peekDataForSeo.mockReset().mockResolvedValue(null);
  mocks.listLlmModels.mockReset().mockResolvedValue([]);
});

describe("LLM_ENGINES", () => {
  it("lists the four engines in order", () => {
    expect(LLM_ENGINES).toEqual(["chat_gpt", "claude", "gemini", "perplexity"]);
  });
});

describe("resolveLlmModel", () => {
  it("prefers the DATAFORSEO_LLM_MODEL_<ENGINE> override and never lists models", async () => {
    await expect(resolveLlmModel("chat_gpt", { DATAFORSEO_LLM_MODEL_CHAT_GPT: " gpt-override " })).resolves.toBe("gpt-override");
    expect(mocks.listLlmModels).not.toHaveBeenCalled();
  });

  it("ignores a blank override and falls back to the model list", async () => {
    mocks.listLlmModels.mockResolvedValue([{ modelName: "claude-x", webSearch: true }]);
    await expect(resolveLlmModel("claude", { DATAFORSEO_LLM_MODEL_CLAUDE: "   " })).resolves.toBe("claude-x");
    expect(mocks.listLlmModels).toHaveBeenCalledExactlyOnceWith("claude");
  });

  it("picks the first web-search model", async () => {
    mocks.listLlmModels.mockResolvedValue([
      { modelName: "plain", webSearch: false },
      { modelName: "searching", webSearch: true },
      { modelName: "also-searching", webSearch: true },
    ]);
    await expect(resolveLlmModel("gemini", {})).resolves.toBe("searching");
  });

  it("falls back to the first model when none supports web search", async () => {
    mocks.listLlmModels.mockResolvedValue([
      { modelName: "first", webSearch: false },
      { modelName: "second", webSearch: false },
    ]);
    await expect(resolveLlmModel("gemini", {})).resolves.toBe("first");
  });

  it("returns null when the engine lists no models", async () => {
    mocks.listLlmModels.mockResolvedValue([]);
    await expect(resolveLlmModel("perplexity", {})).resolves.toBeNull();
  });
});

describe("llmResponseTask", () => {
  it("builds the live call with web search on and the prompt capped at 500 characters", () => {
    const prompt = "x".repeat(600);
    expect(llmResponseTask("claude", prompt, "claude-x")).toEqual({
      endpoint: "/v3/ai_optimization/claude/llm_responses/live",
      task: { user_prompt: "x".repeat(500), model_name: "claude-x", web_search: true },
      estimateUsd: 0.1,
    });
  });
});

describe("trimLlmResponse", () => {
  it("joins section text, keeps valid citations and flags a brand mention", () => {
    expect(trimLlmResponse(llmResult, ["pinecone.io"], "chat_gpt")).toEqual({
      engine: "chat_gpt",
      model: "gpt-4o-search",
      text: "Pinecone is a vector database.\nOther options exist.",
      citations: [{ title: "Pinecone docs", url: "https://docs.pinecone.io/x" }],
      mentionsBrand: true,
    });
  });

  it("returns an empty answer with no brand mention for an empty result", () => {
    expect(trimLlmResponse([], ["pinecone.io"], "claude")).toEqual({
      engine: "claude",
      model: null,
      text: "",
      citations: [],
      mentionsBrand: false,
    });
  });

  it("caps the stored text at 16,000 characters", () => {
    const long = [{ items: [{ type: "message", sections: [{ text: "a".repeat(20_000) }] }] }];
    expect(trimLlmResponse(long, [], "gemini").text).toHaveLength(16_000);
  });

  it("checks the brand against the full stored text, so a mention at character 6,000 is detected", () => {
    const deep = [{ items: [{ type: "message", sections: [{ text: `${"a".repeat(6_000)} Pinecone is cited here.` }] }] }];
    const answer = trimLlmResponse(deep, ["pinecone.io"], "claude");
    expect(answer.mentionsBrand).toBe(true);
    expect(answer.text.indexOf("Pinecone")).toBe(6_001);
  });

  it("reads only message items, so reasoning text and its citations never reach the answer", () => {
    const mixed = [{
      model_name: "claude-x",
      items: [
        {
          type: "reasoning",
          sections: [{
            type: "text",
            text: "Internal chain of thought that mentions pinecone.io",
            annotations: [{ title: "Hidden source", url: "https://hidden.example/x" }],
          }],
        },
        {
          type: "message",
          sections: [{
            type: "text",
            text: "Other options exist.",
            annotations: [{ title: "Shown source", url: "https://shown.example/y" }],
          }],
        },
      ],
    }];
    expect(trimLlmResponse(mixed, ["pinecone.io"], "claude")).toEqual({
      engine: "claude",
      model: "claude-x",
      text: "Other options exist.",
      citations: [{ title: "Shown source", url: "https://shown.example/y" }],
      mentionsBrand: false,
    });
  });

  it("drops citations whose url is not http or https", () => {
    const result = [{ items: [{ type: "message", sections: [{ text: "t", annotations: [
      { title: "bad", url: "javascript:alert(1)" },
      { title: "good", url: "https://example.com/" },
    ] }] }] }];
    expect(trimLlmResponse(result, [], "perplexity").citations).toEqual([{ title: "good", url: "https://example.com/" }]);
  });
});

describe("brandMentioned", () => {
  it("is true for a brand name matching its domain, case-insensitively", () => {
    expect(brandMentioned({ text: "Pinecone is a vector database.", citations: [] }, ["pinecone.io"])).toBe(true);
    expect(brandMentioned({ text: "PINECONE wins", citations: [] }, ["pinecone.io"])).toBe(true);
  });

  it("is true when a citation URL contains the brand domain", () => {
    expect(brandMentioned({ text: "Nothing named", citations: [{ title: null, url: "https://PINECONE.io/docs" }] }, ["pinecone.io"])).toBe(true);
  });

  it("is false when the brand is absent from the text and citations", () => {
    expect(brandMentioned({ text: "Weaviate and Qdrant are options.", citations: [{ title: null, url: "https://qdrant.tech" }] }, ["pinecone.io"])).toBe(false);
    expect(brandMentioned({ text: "Pinecone is great", citations: [] }, [])).toBe(false);
  });

  it("uses the registrable name, not a short public-suffix label", () => {
    expect(brandMentioned({ text: "we co-founded this", citations: [] }, ["example.co.uk"])).toBe(false);
    expect(brandMentioned({ text: "Example Ltd", citations: [] }, ["blog.example.co.uk"])).toBe(true);
  });
});

describe("fetchLlmResponse", () => {
  it("passes the task and llm freshness through runDataForSeo and stores the brand-independent answer", async () => {
    mocks.runDataForSeo.mockResolvedValue({ value: { engine: "chat_gpt", model: null, text: "", citations: [] }, cached: false });
    await fetchLlmResponse("ws-1", "chat_gpt", "best vector db", "gpt-4o-search", ["pinecone.io"]);
    const request = mocks.runDataForSeo.mock.calls[0][0];
    expect(request).toMatchObject({
      workspaceId: "ws-1",
      endpoint: "/v3/ai_optimization/chat_gpt/llm_responses/live",
      task: { user_prompt: "best vector db", model_name: "gpt-4o-search", web_search: true },
      freshnessSeconds: FRESHNESS_SECONDS.llm,
      estimateUsd: 0.1,
    });
    expect(request.freshnessSeconds).toBe(604_800);
    // The cache is global, so the stored value must not carry one workspace's brand verdict.
    expect(request.trim(llmResult)).toEqual({
      engine: "chat_gpt",
      model: "gpt-4o-search",
      text: "Pinecone is a vector database.\nOther options exist.",
      citations: [{ title: "Pinecone docs", url: "https://docs.pinecone.io/x" }],
    });
  });

  it("asks the gate to charge an engine answer its two-credit weight", async () => {
    mocks.runDataForSeo.mockResolvedValue({ value: { engine: "claude", model: null, text: "", citations: [] }, cached: false });
    await fetchLlmResponse("ws-1", "claude", "q", "m", []);
    expect(mocks.runDataForSeo.mock.calls[0][0]).toMatchObject({ credits: 2 });
  });

  it("computes the brand verdict for each caller, even when the answer came from cache", async () => {
    const cached = {
      engine: "chat_gpt",
      model: "gpt-4o-search",
      text: "Pinecone is a vector database.",
      citations: [],
    };
    mocks.runDataForSeo.mockResolvedValue({ value: cached, cached: true });
    const mine = await fetchLlmResponse("ws-1", "chat_gpt", "q", "m", ["pinecone.io"]);
    const theirs = await fetchLlmResponse("ws-2", "chat_gpt", "q", "m", ["weaviate.io"]);
    expect(mine).toEqual({ value: { ...cached, mentionsBrand: true }, cached: true });
    expect(theirs).toEqual({ value: { ...cached, mentionsBrand: false }, cached: true });
  });
});

describe("peekLlmResponse", () => {
  it("reads the cache only and returns null on a miss", async () => {
    await expect(peekLlmResponse("claude", "q", "m", ["pinecone.io"])).resolves.toBeNull();
    expect(mocks.peekDataForSeo).toHaveBeenCalledExactlyOnceWith(
      "/v3/ai_optimization/claude/llm_responses/live",
      { user_prompt: "q", model_name: "m", web_search: true },
      FRESHNESS_SECONDS.llm,
    );
    expect(mocks.runDataForSeo).not.toHaveBeenCalled();
  });

  it("adds the caller's brand verdict to a cached answer", async () => {
    mocks.peekDataForSeo.mockResolvedValue({ engine: "claude", model: "m", text: "Pinecone", citations: [] });
    await expect(peekLlmResponse("claude", "q", "m", ["pinecone.io"])).resolves.toEqual({
      engine: "claude", model: "m", text: "Pinecone", citations: [], mentionsBrand: true,
    });
  });
});

describe("AI keyword volume", () => {
  it("builds the keyword search volume call at 0.05", () => {
    expect(aiKeywordVolumeTask(["crm"])).toEqual({
      endpoint: "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live",
      task: { keywords: ["crm"], location_code: 2840, language_code: "en" },
      estimateUsd: 0.05,
    });
  });

  it("copies keyword and AI search volume, dropping rows without a string keyword", () => {
    expect(trimAiKeywordVolume([{ items: [
      { keyword: "crm", ai_search_volume: 500, extra: "ignored" },
      { keyword: 3, ai_search_volume: 9 },
      { ai_search_volume: 4 },
      { keyword: "x", ai_search_volume: "n" },
    ] }])).toEqual([
      { keyword: "crm", aiSearchVolume: 500 },
      { keyword: "x", aiSearchVolume: 0 },
    ]);
  });

  it("reads nothing from the flat row shape, which the API does not return", () => {
    // The response nests rows under result[0].items; a flat array is not the real shape and must yield [].
    expect(trimAiKeywordVolume([
      { keyword: "crm", ai_search_volume: 500 },
    ])).toEqual([]);
  });

  it("fetch uses the aiKeywords freshness; peek reads the cache only", async () => {
    await fetchAiKeywordVolume("ws-1", ["crm"]);
    expect(mocks.runDataForSeo.mock.calls[0][0]).toMatchObject({
      endpoint: "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live",
      freshnessSeconds: FRESHNESS_SECONDS.aiKeywords,
      trim: trimAiKeywordVolume,
    });
    await peekAiKeywordVolume(["crm"]);
    expect(mocks.peekDataForSeo).toHaveBeenCalledExactlyOnceWith(
      "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live",
      aiKeywordVolumeTask(["crm"]).task,
      FRESHNESS_SECONDS.aiKeywords,
    );
  });
});
