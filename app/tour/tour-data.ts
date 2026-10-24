/**
 * Sample data for the /tour demo workspace. Nothing here is live: the page says so on its face.
 * "Sample tracing SDK" is a made-up open-source LLM tracing tool used as the demo customer.
 */
import type { GlyphFeatures } from "@/components/glyph";

export type PanelId = "queue" | "sources" | "opportunity" | "reply" | "search" | "content" | "start";

/** Features not shipped yet. Their panels say "Preview" until the id is removed from this set. */
export const PREVIEW: ReadonlySet<PanelId> = new Set<PanelId>(["search", "content"]);

export const PANELS: { id: PanelId; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "sources", label: "Sources" },
  { id: "opportunity", label: "Opportunity" },
  { id: "reply", label: "Reply" },
  { id: "search", label: "Search" },
  { id: "content", label: "Content" },
  { id: "start", label: "Start" },
];

export const WORKSPACE = "Sample tracing SDK";

export type QueueItem = {
  source: string;
  where: string;
  title: string;
  age: string;
  features: GlyphFeatures;
};

export const QUEUE: QueueItem[] = [
  {
    source: "Reddit",
    where: "r/LocalLLaMA",
    title: "How are you all debugging agent loops that fail without an error?",
    age: "2h",
    features: { fit: 0.88, intent: 0.74, evidence: 0.66, momentum: 0.52, timing: 0.91 },
  },
  {
    source: "Hacker News",
    where: "Ask HN",
    title: "What do you use to trace tool calls in production agents?",
    age: "5h",
    features: { fit: 0.81, intent: 0.8, evidence: 0.48, momentum: 0.6, timing: 0.78 },
  },
  {
    source: "X",
    where: "@buildwithmara",
    title: "Looking for something self-hosted that shows the whole LangGraph run, not just the last step",
    age: "7h",
    features: { fit: 0.84, intent: 0.86, evidence: 0.3, momentum: 0.44, timing: 0.7 },
  },
  {
    source: "Forum",
    where: "community.openai.com",
    title: "Responses API: retries are invisible in our logs, any tooling?",
    age: "11h",
    features: { fit: 0.7, intent: 0.62, evidence: 0.4, momentum: 0.3, timing: 0.6 },
  },
  {
    source: "GitHub",
    where: "langgraph issues",
    title: "Feature request: export the full call tree for a failed run",
    age: "1d",
    features: { fit: 0.66, intent: 0.5, evidence: 0.58, momentum: 0.38, timing: 0.42 },
  },
];

/** The raw, unranked stream behind the queue: what the collectors read before scoring. */
export const STREAM: { source: string; text: string }[] = [
  { source: "Reddit", text: "Which vector DB are you using in 2026?" },
  { source: "X", text: "hot take: most agents are just while loops with a credit card" },
  { source: "Hacker News", text: "Show HN: a terminal UI for Postgres" },
  { source: "Stack Overflow", text: "TypeError: Cannot read properties of undefined (reading 'tool_calls')" },
  { source: "YouTube", text: "I built an AI agent in 10 minutes" },
  { source: "Reddit", text: "Our OpenAI bill tripled and we can't tell why" },
  { source: "GitHub", text: "Streaming breaks when the tool returns an empty array" },
  { source: "Product Hunt", text: "Launching today: yet another prompt manager" },
  { source: "Substack", text: "The case against agent frameworks" },
  { source: "X", text: "anyone else's agent stuck calling search() forever?" },
  { source: "LinkedIn", text: "5 lessons from shipping LLM features to enterprise" },
  { source: "Forum", text: "Rate limits on the batch API, again" },
  { source: "Reddit", text: "Self-hosted alternatives to hosted LLM observability?" },
  { source: "Hacker News", text: "Ask HN: How do you test non-deterministic code?" },
];

/** Posts read per source in the sample run. They add up to the total shown on the page. */
export const SOURCE_READS: { source: string; read: number }[] = [
  { source: "Reddit", read: 812 },
  { source: "X", read: 401 },
  { source: "Hacker News", read: 344 },
  { source: "Dev forums", read: 216 },
  { source: "GitHub issues", read: 128 },
  { source: "Stack Overflow", read: 97 },
  { source: "YouTube", read: 54 },
  { source: "LinkedIn", read: 35 },
  { source: "Product Hunt", read: 31 },
  { source: "Substack", read: 22 },
];

export const TOTAL_READ = SOURCE_READS.reduce((n, s) => n + s.read, 0);
export const RELEVANT = 38;

export const EVIDENCE: { source: string; who: string; text: string }[] = [
  {
    source: "Reddit, r/LocalLLaMA",
    who: "u/quietgradient",
    text: "Our agent retried the same tool call 40 times overnight. No error, no alert, just a bill. How are you all catching this?",
  },
  {
    source: "X",
    who: "@ops_hannah",
    text: "Same. The logs show the last step and nothing about what called it.",
  },
  {
    source: "Hacker News",
    who: "kvrn",
    text: "We ended up writing our own tracer because nothing showed the full tool-call tree. Would rather not maintain it.",
  },
];

export const WHY_RANKED: string[] = [
  "Asks for a way to see agent retries, which is what Sample tracing SDK does.",
  "Two more people on X and Hacker News describe the same problem.",
  "Posted two hours ago and still getting replies.",
];

export type QueryRow = { query: string; impressions: number; clicks: number; position: number; gap?: boolean };

export const GSC_ROWS: QueryRow[] = [
  { query: "trace llm agent tool calls", impressions: 2310, clicks: 41, position: 8.2 },
  { query: "debug agent loop", impressions: 1880, clicks: 3, position: 34.0, gap: true },
  { query: "langgraph tracing open source", impressions: 960, clicks: 22, position: 6.4 },
  { query: "llm observability self hosted", impressions: 720, clicks: 9, position: 15.1 },
];

export const ANSWER_ENGINES: { engine: string; prompt: string; cited: boolean; note: string }[] = [
  {
    engine: "ChatGPT",
    prompt: "How do I debug an AI agent that keeps retrying a tool call?",
    cited: false,
    note: "Four sources cited. example.com is not one of them.",
  },
  {
    engine: "Perplexity",
    prompt: "How do I debug an AI agent that keeps retrying a tool call?",
    cited: false,
    note: "Six sources cited, all forum threads and docs. No product pages.",
  },
  {
    engine: "Google AI Overviews",
    prompt: "debug agent loop",
    cited: false,
    note: "An overview is shown. It cites two blog posts and a GitHub issue.",
  },
];
