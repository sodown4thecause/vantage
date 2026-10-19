import type { ReactNode } from "react";

/*
 * Result cards for the SEO chat. Client-safe: no server imports, so the chat client can render them. Provider output is
 * untrusted data: every value renders as React text, and a link is made only for an http or https URL.
 */

export type CardView = {
  tool: string;
  title: string;
  fetchedAt: string | null;
  cached: boolean;
  data: unknown;
};

type Props = { card: CardView; sandbox: boolean };

const ENGINE_LABELS: Record<string, string> = {
  chat_gpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const rowsOf = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? data.filter(isRecord) : []);

const count = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
const day = (value: string | null): string => (value ? value.slice(0, 10) : "Unknown");

/** A link target only when the URL parses as http or https; anything else (javascript:, data:, junk) is shown as text. */
function safeHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function SafeLink({ url }: { url: string | null }) {
  const href = safeHref(url);
  if (!href) return <>{url ?? "—"}</>;
  return (
    <a href={href} rel="noopener noreferrer nofollow" className="link break-all">
      {url}
    </a>
  );
}

function DataTable({ caption, headers, empty, children }: { caption: string; headers: string[]; empty: boolean; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="mb-2 text-left font-semibold text-ink">{caption}</caption>
        <thead>
          <tr className="border-b border-contour text-ridge">
            {headers.map((header) => (
              <th key={header} scope="col" className="py-2 pr-4 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td colSpan={headers.length} className="py-2 text-ridge">
                No results.
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

function backlinkSummary({ card }: Props) {
  const data = isRecord(card.data) ? card.data : {};
  const rows: [string, string][] = [
    ["Domain rank", count(data.rank)],
    ["Backlinks", count(data.backlinks)],
    ["Referring domains", count(data.referringDomains)],
    ["Referring main domains", count(data.referringMainDomains)],
    ["Broken backlinks", count(data.brokenBacklinks)],
    ["Spam score", count(data.spamScore)],
    ["First seen", day(str(data.firstSeen))],
  ];
  return (
    <DataTable caption={card.title} headers={["Metric", "Value"]} empty={false}>
      {rows.map(([label, value]) => (
        <tr key={label} className="border-b border-contour">
          <td className="py-2 pr-4 text-ridge">{label}</td>
          <td className="py-2 pr-4">{value}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function referringDomains({ card }: Props) {
  const rows = rowsOf(card.data);
  return (
    <DataTable caption={card.title} headers={["Domain", "Rank", "Backlinks", "First seen"]} empty={rows.length === 0}>
      {rows.map((row, i) => (
        <tr key={`${i}-${str(row.domain) ?? ""}`} className="border-b border-contour">
          <td className="break-all py-2 pr-4">{str(row.domain) ?? "—"}</td>
          <td className="py-2 pr-4">{count(row.rank)}</td>
          <td className="py-2 pr-4">{count(row.backlinks)}</td>
          <td className="py-2 pr-4">{day(str(row.firstSeen))}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function anchors({ card }: Props) {
  const rows = rowsOf(card.data);
  return (
    <DataTable caption={card.title} headers={["Anchor", "Backlinks", "Referring domains"]} empty={rows.length === 0}>
      {rows.map((row, i) => {
        const anchor = str(row.anchor) ?? "";
        return (
          <tr key={`${i}-${anchor}`} className="border-b border-contour">
            <td className="break-words py-2 pr-4">{anchor === "" ? "(no anchor text)" : anchor}</td>
            <td className="py-2 pr-4">{count(row.backlinks)}</td>
            <td className="py-2 pr-4">{count(row.referringDomains)}</td>
          </tr>
        );
      })}
    </DataTable>
  );
}

function keywordRows(rows: Record<string, unknown>[], withRanking: boolean) {
  return rows.map((row, i) => (
    <tr key={`${i}-${str(row.keyword) ?? ""}`} className="border-b border-contour">
      <td className="break-words py-2 pr-4">{str(row.keyword) ?? "—"}</td>
      <td className="py-2 pr-4">{count(row.searchVolume)}</td>
      <td className="py-2 pr-4">{count(row.difficulty)}</td>
      <td className="py-2 pr-4">{str(row.intent) ?? "—"}</td>
      {withRanking && <td className="py-2 pr-4">{count(row.position)}</td>}
      {withRanking && (
        <td className="py-2 pr-4">
          <SafeLink url={str(row.url)} />
        </td>
      )}
    </tr>
  ));
}

function keywordIdeas({ card }: Props) {
  const rows = rowsOf(card.data);
  return (
    <DataTable caption={card.title} headers={["Keyword", "Volume", "Difficulty", "Intent"]} empty={rows.length === 0}>
      {keywordRows(rows, false)}
    </DataTable>
  );
}

function rankedKeywords({ card }: Props) {
  const rows = rowsOf(card.data);
  return (
    <DataTable
      caption={card.title}
      headers={["Keyword", "Volume", "Difficulty", "Intent", "Position", "URL"]}
      empty={rows.length === 0}
    >
      {keywordRows(rows, true)}
    </DataTable>
  );
}

function competitorDomains({ card }: Props) {
  const rows = rowsOf(card.data);
  return (
    <DataTable caption={card.title} headers={["Domain", "Average position", "Shared keywords"]} empty={rows.length === 0}>
      {rows.map((row, i) => (
        <tr key={`${i}-${str(row.domain) ?? ""}`} className="border-b border-contour">
          <td className="break-all py-2 pr-4">{str(row.domain) ?? "—"}</td>
          <td className="py-2 pr-4">{count(row.avgPosition)}</td>
          <td className="py-2 pr-4">{count(row.intersections)}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function googleSerp({ card }: Props) {
  const data = isRecord(card.data) ? card.data : {};
  const organic = rowsOf(data.organic);
  const questions = Array.isArray(data.peopleAlsoAsk)
    ? data.peopleAlsoAsk.flatMap((question) => (typeof question === "string" ? [question] : []))
    : [];
  return (
    <div className="space-y-3">
      <DataTable caption={card.title} headers={["Position", "Domain", "Title", "URL"]} empty={organic.length === 0}>
        {organic.map((row, i) => (
          <tr key={`${i}-${str(row.url) ?? ""}`} className="border-b border-contour">
            <td className="py-2 pr-4">{count(row.position)}</td>
            <td className="break-all py-2 pr-4">{str(row.domain) ?? "—"}</td>
            <td className="break-words py-2 pr-4">{str(row.title) ?? ""}</td>
            <td className="py-2 pr-4">
              <SafeLink url={str(row.url)} />
            </td>
          </tr>
        ))}
      </DataTable>
      <p className="text-sm text-ridge">AI overview: {data.hasAiOverview === true ? "present" : "not shown"}</p>
      {questions.length > 0 && (
        <div className="text-sm">
          <p className="text-ridge">People also ask</p>
          <ul className="list-disc pl-5">
            {questions.map((question, i) => (
              <li key={`${i}-${question}`}>{question}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function llmResponse({ card }: Props) {
  const data = isRecord(card.data) ? card.data : {};
  const engine = str(data.engine) ?? "";
  const citations = Array.isArray(data.citations) ? data.citations.filter(isRecord) : [];
  return (
    <div className="space-y-3">
      <DataTable caption={card.title} headers={["Engine", "Mentions your brand"]} empty={false}>
        <tr className="border-b border-contour">
          <td className="py-2 pr-4">{ENGINE_LABELS[engine] ?? (engine || "—")}</td>
          <td className="py-2 pr-4">{data.mentionsBrand === true ? "Yes" : "No"}</td>
        </tr>
      </DataTable>
      {str(data.text) && <p className="whitespace-pre-line text-sm leading-relaxed">{str(data.text)}</p>}
      {citations.length > 0 && (
        <div className="text-sm">
          <p className="text-ridge">Citations</p>
          <ul className="list-disc space-y-1 pl-5">
            {citations.map((citation, i) => {
              const url = str(citation.url);
              return (
                <li key={`${i}-${url ?? ""}`} className="break-words">
                  {str(citation.title) && <span className="mr-2">{str(citation.title)}</span>}
                  <SafeLink url={url} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function aiKeywordVolume({ card }: Props) {
  const rows = rowsOf(card.data);
  return (
    <DataTable caption={card.title} headers={["Keyword", "AI search volume"]} empty={rows.length === 0}>
      {rows.map((row, i) => (
        <tr key={`${i}-${str(row.keyword) ?? ""}`} className="border-b border-contour">
          <td className="break-words py-2 pr-4">{str(row.keyword) ?? "—"}</td>
          <td className="py-2 pr-4">{count(row.aiSearchVolume)}</td>
        </tr>
      ))}
    </DataTable>
  );
}

/** A tool this build does not know: its title and its data as text, so nothing is hidden and nothing runs. */
function fallback({ card }: Props) {
  return (
    <figure className="space-y-2">
      <figcaption className="font-semibold text-ink">{card.title}</figcaption>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-ridge">
        {JSON.stringify(card.data ?? null, null, 2)}
      </pre>
    </figure>
  );
}

const RENDERERS: Record<string, (props: Props) => ReactNode> = {
  backlink_summary: backlinkSummary,
  referring_domains: referringDomains,
  backlink_gap: referringDomains,
  anchors,
  keyword_ideas: keywordIdeas,
  keyword_overview: keywordIdeas,
  ranked_keywords: rankedKeywords,
  competitor_domains: competitorDomains,
  keyword_gap: rankedKeywords,
  google_serp: googleSerp,
  llm_response: llmResponse,
  ai_keyword_volume: aiKeywordVolume,
};

export function ResultCardView({ card, sandbox }: Props) {
  const render = Object.prototype.hasOwnProperty.call(RENDERERS, card.tool) ? RENDERERS[card.tool]! : fallback;
  const cachedLabel = card.cached ? (card.fetchedAt ? `Cached ${day(card.fetchedAt)}` : "Cached") : null;
  return (
    <section className="space-y-3" data-tool={card.tool}>
      {(cachedLabel || sandbox) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ridge">
          {cachedLabel && <span className="rounded-full px-2.5 py-0.5 shadow-[inset_0_0_0_1px_var(--contour)]">{cachedLabel}</span>}
          {sandbox && <span className="font-semibold">Sandbox data: not real figures.</span>}
        </p>
      )}
      {render({ card, sandbox })}
    </section>
  );
}
