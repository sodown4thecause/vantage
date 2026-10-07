// ---------------------------------------------------------------------------
// Entity alias map + deterministic canonicalization (pure).
//
// This is the SOURCE OF TRUTH for collapsing mentions like
// `Claude Code` / `claude-code` / `@anthropic` -> a canonical entity. The LLM
// only *suggests* aliases (via `entities` in the classifier output); it never
// decides identity. An alias map does the collapsing, so every merge is
// auditable and reproducible.
//
// Design notes:
//  - Matching is case-insensitive and whitespace/punctuation-normalized.
//  - Exact and alias keys both resolve; the first-seen canonical wins for ties.
//  - Unknown mentions canonicalize to themselves (normalized form) rather than
//    being discarded, so coverage can grow without losing data.
// ---------------------------------------------------------------------------

/** Seed alias map. Keys are normalized mentions; values are canonical entities. */
export const ENTITY_ALIASES: Readonly<Record<string, string>> = {
  // Anthropic / Claude
  "claude": "Anthropic Claude",
  "claude code": "Anthropic Claude Code",
  "claude-code": "Anthropic Claude Code",
  "claudecode": "Anthropic Claude Code",
  "anthropic": "Anthropic",
  "@anthropic": "Anthropic",
  "claude api": "Anthropic API",
  "anthropic api": "Anthropic API",

  // OpenAI / ChatGPT
  "openai": "OpenAI",
  "@openai": "OpenAI",
  "chatgpt": "OpenAI ChatGPT",
  "chat gpt": "OpenAI ChatGPT",
  "gpt": "OpenAI GPT",
  "gpt-4": "OpenAI GPT-4",
  "codex": "OpenAI Codex",

  // Cursor / tools
  "cursor": "Cursor",
  "cursor ai": "Cursor",
  "cursorai": "Cursor",
  "github copilot": "GitHub Copilot",
  "copilot": "GitHub Copilot",
  "windsurf": "Windsurf",
  "cline": "Cline",
  "aider": "Aider",
  "devin": "Devin",
  "replit": "Replit",

  // Google
  "google": "Google",
  "gemini": "Google Gemini",
  "google gemini": "Google Gemini",
  "bard": "Google Gemini",

  // Others
  "langchain": "LangChain",
  "llamaindex": "LlamaIndex",
  "vercel": "Vercel",
  "v0": "Vercel v0",
  "supabase": "Supabase",
  "huggingface": "Hugging Face",
  "hugging face": "Hugging Face",
  "mistral": "Mistral AI",
  "mistral ai": "Mistral AI",
  "meta": "Meta",
  "llama": "Meta Llama",
  "github": "GitHub",
  "vscode": "VS Code",
  "vs code": "VS Code",
};

/**
 * Normalize a raw mention for lookup and for the "unknown entity" fallback key.
 * Lowercases, trims, drops a leading `@`, collapses whitespace, and removes
 * surrounding punctuation. Digits and internal hyphens are preserved.
 */
export function normalizeMention(mention: string): string {
  return mention
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[\u2018\u2019\u201c\u201d]/g, "")
    .replace(/[^a-z0-9+.#\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.#\-\s]+|[.#\-\s]+$/g, "")
    .trim();
}

/**
 * Resolve a raw mention to a canonical entity name.
 *
 * Order of resolution:
 *   1. exact normalized key in the alias map
 *   2. a whitespace/hyphen-insensitive variant (e.g. `claude code` <-> `claude-code`)
 *   3. the raw normalized mention itself (self-canonical fallback)
 *
 * Deterministic: the alias map is consulted in a fixed iteration order, so a
 * given input always yields the same canonical name.
 */
export function canonicalizeEntity(
  mention: string,
  aliases: Readonly<Record<string, string>> = ENTITY_ALIASES,
): string {
  const normalized = normalizeMention(mention);
  if (normalized === "") return "";
  const exact = aliases[normalized];
  if (exact !== undefined) return exact;

  // Hyphen/space-insensitive variant: look for a key whose normalized form (with
  // spaces and hyphens collapsed) equals the same collapse of our mention.
  const collapsed = normalized.replace(/[\s-]+/g, "");
  for (const [key, canonical] of Object.entries(aliases)) {
    if (key.replace(/[\s-]+/g, "") === collapsed) return canonical;
  }
  return normalized;
}

/**
 * Canonicalize a list of raw mentions into unique entity names, preserving
 * first-seen order. Pure.
 */
export function canonicalizeEntities(
  mentions: ReadonlyArray<string>,
  aliases: Readonly<Record<string, string>> = ENTITY_ALIASES,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const mention of mentions) {
    const canonical = canonicalizeEntity(mention, aliases);
    if (canonical === "" || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}
