import { EVIDENCE, GSC_ROWS, QUEUE, WORKSPACE } from "./tour-data";

export type DemoLane = "gtm" | "seo" | "geo" | "content";
export type DemoEvidence = { source: string; title: string; text: string };
export type DemoAction = { prompt: string; reason: string; answer: string; evidence: DemoEvidence[] };
export type DemoTurn = { role: "user" | "assistant"; content: string };

const conversations = EVIDENCE.map((post) => ({ source: `Sample · ${post.source}`, title: QUEUE.find((item) => post.source.startsWith(item.source))!.title, text: post.text }));
const search = GSC_ROWS.map((row) => ({ source: "Sample · Search Console preview", title: row.query, text: `${row.impressions.toLocaleString("en-US")} illustrative impressions · ${row.clicks} illustrative clicks · position ${row.position}. No Search Console account is connected.` }));
const geo = [{ source: "Sample · GEO research preview", title: "How do I debug an agent that keeps retrying?", text: "An illustrative research question, not an AI-engine result. No answer engine has been queried and no citation tracking is running." }];
const content = [{ source: "Sample · Content workflow preview", title: "Debug an agent loop before it burns your budget", text: "Proposed outline: reproduce the loop, inspect the parent tool call, set a retry limit, and verify the fix. This is a prewritten example, not generated or published content." }];

export const DEMO_LANES: { id: DemoLane; label: string; icon: string; preview: boolean }[] = [
  { id: "gtm", label: "GTM", icon: "◈", preview: false },
  { id: "seo", label: "SEO", icon: "⌕", preview: true },
  { id: "geo", label: "GEO", icon: "◎", preview: true },
  { id: "content", label: "Content", icon: "▤", preview: true },
];

export const DEMO: Record<DemoLane, { heading: string; introduction: string; evidence: DemoEvidence[]; actions: [DemoAction, DemoAction, DemoAction] }> = {
  gtm: {
    heading: "Find your people. Start the right conversation.",
    introduction: `${WORKSPACE} is a fictional, open-source agent tracing tool. Explore how a GTM conversation connects a buying signal to a useful next step. Every conversation here is sample data.`,
    evidence: conversations,
    actions: [
      { prompt: "Which conversation should I join first?", reason: "Start with a specific problem your product can help solve.", answer: "In this sample, start with the Reddit discussion about an agent retrying a tool call 40 times. The author describes a concrete pain and asks how to catch it. Sample tracing SDK’s call-tree tracing is relevant, but that alone doesn’t prove they want to buy. Read the thread and help diagnose the loop before mentioning a product.", evidence: [conversations[0]] },
      { prompt: "Show me the buying intent", reason: "Separate a useful signal from an assumption.", answer: "The sample Hacker News author says they built a tracer and would rather not maintain it. That suggests a possible alternative-tool search, not a confirmed purchase. Ask what their current tracer misses and whether self-hosting matters before qualifying them further.", evidence: [conversations[2]] },
      { prompt: "Help me plan a useful first response", reason: "Lead with help, not a pitch.", answer: "A sample response approach: ask whether each retry keeps its parent tool-call ID, then suggest inspecting the first failed call rather than the final error. Explain your connection to Sample tracing SDK if you mention it. You decide what to write and post; nothing is posted on your behalf.", evidence: [conversations[0], conversations[1]] },
    ],
  },
  seo: {
    heading: "Turn a search question into a useful next step.",
    introduction: "SEO workflow preview. These illustrative search metrics show a possible research conversation, not a connected Search Console account or a live audit.",
    evidence: search,
    actions: [
      { prompt: "Explore the sample search gap", reason: "Use an illustrative query to frame the research.", answer: "Preview: “debug agent loop” has illustrative impressions but few clicks in this sample. A useful next step would be to inspect the actual ranking page and search intent. These numbers are invented; no audit or Search Console sync has run.", evidence: [search[1]] },
      { prompt: "What would I check before writing?", reason: "Validate intent before choosing a page.", answer: "Preview: check whether searchers need a debugging tutorial, a tracing tool, or framework documentation. Compare your existing page with that intent before drafting. This demo has not fetched search results or inspected a website.", evidence: [search[0], search[1]] },
      { prompt: "Connect this topic to the GTM sample", reason: "Ground a possible article in a real kind of problem.", answer: "Preview: the sample retry-loop conversation suggests a practical tutorial about finding the first failed tool call. It is a topic hypothesis, not a measured keyword opportunity. Validate demand and your product’s fit before investing in it.", evidence: [conversations[0]] },
    ],
  },
  geo: {
    heading: "Explore the questions behind an AI answer.",
    introduction: "GEO research preview. Explore an illustrative question and a possible research plan. Live answer-engine monitoring and citation tracking are not demonstrated here.",
    evidence: geo,
    actions: [
      { prompt: "Explore a sample buyer question", reason: "Start with the problem, not a visibility score.", answer: "Research preview: “How do I debug an agent that keeps retrying?” is a plausible question for Sample tracing SDK’s audience. We would first establish what a useful, accurate answer needs. No engine has been queried and this is not a visibility report.", evidence: geo },
      { prompt: "What evidence would an answer need?", reason: "Make claims verifiable before seeking citations.", answer: "Research preview: a helpful answer could show a reproducible retry loop, an annotated call tree, and the limits of the proposed fix. These are proposed evidence requirements, not a claim that an AI engine cites Sample tracing SDK.", evidence: [...geo, conversations[0]] },
      { prompt: "What is not live in this preview?", reason: "Understand the boundary of the demo.", answer: "This GEO preview does not run prompts against answer engines, monitor citations, or measure visibility. It only shows a prewritten research conversation. Create a workspace to explore available tools; this preview is not a promise that these workflows are shipped.", evidence: geo },
    ],
  },
  content: {
    heading: "Make something worth reading.",
    introduction: "Content workflow preview. Follow a prewritten brief from the sample customer problem. Nothing is generated, edited by a model, or published in this demo.",
    evidence: content,
    actions: [
      { prompt: "Show me the sample brief", reason: "Give the article one clear job.", answer: "Content preview: help an engineer identify the first failing tool call in a retry loop. Use one reproducible example, an annotated trace, and a concrete retry limit. The sample outline is beside this conversation; it is prewritten, not a generated draft.", evidence: content },
      { prompt: "Check the brief against the problem", reason: "Keep the reader’s question at the center.", answer: "Content preview: the sample reader cannot see what caused the repeated calls. The brief should explain parent-child tracing before discussing products. Avoid promising that tracing alone prevents every loop or reduces every bill.", evidence: [conversations[0], ...content] },
      { prompt: "What happens before publishing?", reason: "Keep review and control with the author.", answer: "Content preview: reproduce the technical example, verify every claim, remove generic filler, and review any product disclosure. This demo cannot publish anything. The dedicated Content workflow is a preview, not a live publishing tool.", evidence: content },
    ],
  },
};

export function demoReply(lane: DemoLane, message: string): { answer: string; evidence: DemoEvidence[] } {
  const action = DEMO[lane].actions.find((item) => item.prompt === message.trim());
  return action ? { answer: action.answer, evidence: action.evidence } : {
    answer: "This is a guided sample workspace, not a live assistant. Your message was not sent to a model or an external service. Choose one of the three suggested actions to explore a prewritten conversation, or create a workspace for your own product. SEO, GEO, and Content examples are explicitly previews, not live capabilities.",
    evidence: DEMO[lane].evidence,
  };
}
