import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { seoModels as fromConfig } from "@/lib/seo-agent/model-config";
import { seoModels as fromModels } from "@/lib/seo-agent/models";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("model-config", () => {
  it("does not import the ai package, so the shell can read it without the SDK", () => {
    const text = source("lib/seo-agent/model-config.ts");
    expect(text).not.toMatch(/from\s+["']ai["']/);
    expect(text).not.toMatch(/import\s*\(\s*["']ai["']\s*\)/);
    expect(text).not.toMatch(/require\(\s*["']ai["']\s*\)/);
  });

  it("is what the shell imports, and models.ts re-exports the same function", () => {
    expect(source("components/shell.tsx")).toContain('from "@/lib/seo-agent/model-config"');
    expect(source("components/shell.tsx")).not.toContain('from "@/lib/seo-agent/models"');
    expect(fromModels).toBe(fromConfig);
  });

  it("reads the same configuration from the environment as before the move", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
    vi.stubEnv("SEO_AGENT_MODEL", "");
    vi.stubEnv("SEO_CLASSIFIER_MODEL", "");
    vi.stubEnv("SEO_AGENT_FALLBACK_MODEL", "");
    expect(fromConfig()).toEqual({
      executor: "anthropic/claude-sonnet-5.5",
      classifier: "reflection/beam",
      summarizer: "anthropic/claude-sonnet-5.5",
      fallback: null,
    });
    vi.stubEnv("SEO_SUMMARIZER_MODEL", "anthropic/claude-opus-test");
    expect(fromConfig()?.summarizer).toBe("anthropic/claude-opus-test");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    expect(fromConfig()).toBeNull();
    vi.unstubAllEnvs();
  });
});
