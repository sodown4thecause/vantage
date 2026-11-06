import type { AgentScope } from "@/lib/agent/config";

export const MCP_LATEST_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18"] as const;

export type McpContext = {
  workspaceId: string | null;
  userId: string | null;
  scopes: string[];
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  inputSchema: Record<string, unknown>;
  requiredScope: AgentScope;
  run(input: Record<string, unknown>, ctx: McpContext): Promise<unknown>;
};

export type McpHttpResult = { status: number; body?: unknown };

const JSONRPC = "2.0";

const error = (id: unknown, code: number, message: string): McpHttpResult => ({
  status: 200,
  body: { jsonrpc: JSONRPC, id: id ?? null, error: { code, message } },
});

const result = (id: unknown, value: unknown): McpHttpResult => ({
  status: 200,
  body: { jsonrpc: JSONRPC, id: id ?? null, result: value },
});

function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" &&
    (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_LATEST_PROTOCOL_VERSION;
}

function toolList(tools: McpTool[], scopes: string[]) {
  return tools
    .filter((tool) => scopes.includes(tool.requiredScope))
    .map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
}

/**
 * Handles one JSON-RPC message from a Streamable HTTP POST. Stateless: no session
 * id is issued, so every request carries its own credential. Notifications get
 * 202 with no body, as the transport requires.
 */
export async function handleMcpMessage(
  message: unknown,
  ctx: McpContext,
  tools: McpTool[],
): Promise<McpHttpResult> {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    return error(null, -32600, "Invalid Request");
  }
  const request = message as Record<string, unknown>;
  if (request.jsonrpc !== JSONRPC || typeof request.method !== "string") {
    return error(request.id, -32600, "Invalid Request");
  }

  const isNotification = !("id" in request);
  const id = request.id;
  const params = (typeof request.params === "object" && request.params !== null
    ? request.params
    : {}) as Record<string, unknown>;

  if (isNotification) {
    // `notifications/initialized` and `notifications/cancelled` need no work here.
    return { status: 202 };
  }

  switch (request.method) {
    case "initialize":
      return result(id, {
        protocolVersion: negotiateVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "vantage", title: "Vantage", version: "0.1.0" },
        instructions:
          "Vantage finds conversations worth joining and drafts replies. It never posts, " +
          "replies or messages anyone. Every tool is read-only or returns text for a human " +
          "to send themselves.",
      });

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, { tools: toolList(tools, ctx.scopes) });

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) return error(id, -32602, `Unknown tool: ${name || "(missing)"}`);
      if (!ctx.scopes.includes(tool.requiredScope)) {
        return error(id, -32602, `This credential lacks the ${tool.requiredScope} scope.`);
      }
      const args = (typeof params.arguments === "object" && params.arguments !== null
        ? params.arguments
        : {}) as Record<string, unknown>;
      try {
        const value = await tool.run(args, ctx);
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
          structuredContent: value,
          isError: false,
        });
      } catch (err) {
        // Tool failures are reported in-band so the model can read them; the
        // message is deliberately generic because it may reach a third party.
        console.error("[agent/mcp] tool failed", {
          tool: tool.name,
          error: err instanceof Error ? err.name : "unknown",
        });
        return result(id, {
          content: [{ type: "text", text: "The tool could not complete this request." }],
          isError: true,
        });
      }
    }

    default:
      return error(id, -32601, "Method not found");
  }
}
