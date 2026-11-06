import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MARKETPLACE = join(ROOT, ".claude-plugin/marketplace.json");
const CODEX_EXAMPLE = join(ROOT, "plugins/codex/config.toml.example");

type Marketplace = {
  name: string;
  owner: { name: string };
  plugins: Array<{ name: string; source: string; description: string }>;
};

type PluginManifest = {
  name: string;
  version: string;
  mcpServers: Record<string, { type: string; url: string }>;
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

const marketplace = readJson<Marketplace>(MARKETPLACE);
const entry = marketplace.plugins[0]!;
const pluginRoot = join(ROOT, entry.source);
// Resolved through the marketplace entry, so a broken `source` fails here.
const manifestPath = join(pluginRoot, ".claude-plugin/plugin.json");
const manifest = readJson<PluginManifest>(manifestPath);
const server = manifest.mcpServers.vantage!;

describe("Claude Code plugin manifests", () => {
  it("points the marketplace entry at a real plugin directory", () => {
    expect(marketplace.name).toBe("vantage");
    expect(entry.name).toBe("vantage");
    expect(entry.source.startsWith("./")).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
  });

  it("declares the MCP server as a remote HTTP endpoint", () => {
    expect(manifest.name).toBe(entry.name);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(server.type).toBe("http");
    expect(server.url).toMatch(/^https:\/\/[^/]+\/api\/mcp$/);
  });

  it("keeps the Codex example on the same endpoint", () => {
    const toml = readFileSync(CODEX_EXAMPLE, "utf8");
    expect(toml).toContain("[mcp_servers.vantage]");
    expect(toml).toContain(`url = "${server.url}"`);
  });

  it("carries no credentials", () => {
    // Every file a client reads, including the plugin manifest that holds the
    // server URL: a credential added there would otherwise pass unnoticed.
    const raw =
      readFileSync(MARKETPLACE, "utf8") +
      readFileSync(manifestPath, "utf8") +
      readFileSync(CODEX_EXAMPLE, "utf8");
    expect(raw).not.toMatch(/bearer|api[_-]?key|secret|token/i);
  });
});
