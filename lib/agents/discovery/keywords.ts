import type { ResearchEvidence } from "./types";

export type DiscoveryKeyword = { term: string; reason: string; evidenceIds: string[] };
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "are", "you", "your", "our", "their", "into", "can", "will", "has", "have", "not"]);
const terms = (value: string) => [...new Set((value.toLowerCase().match(/[a-z0-9][a-z0-9.+#-]{2,}/g) ?? []).filter(word => !STOP.has(word)))];

/** Keep only phrases whose meaningful words occur in verified source text. */
export function groundKeywords(candidates: DiscoveryKeyword[], evidence: ResearchEvidence[]): { keywords: DiscoveryKeyword[]; unknowns: string[] } {
  const byId = new Map(evidence.map(item => [item.id, item]));
  const grounded: DiscoveryKeyword[] = [];
  const unknowns: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const words = terms(candidate.term);
    const references = candidate.evidenceIds.map(id => byId.get(id)!);
    const phraseGrounded = words.length > 0 && references.some(item => {
      const excerpt = item.excerpt.toLowerCase();
      return words.every(word => excerpt.includes(word));
    });
    if (!phraseGrounded) {
      unknowns.push(`Keyword “${candidate.term}” was not included because the cited pages do not support it.`);
      continue;
    }
    grounded.push(candidate);
  }
  const keywords = grounded.slice(0, 12);
  const omitted = grounded.length - keywords.length;
  if (omitted > 0) unknowns.push(`${omitted} additional grounded keyword${omitted === 1 ? " was" : "s were"} deferred to stay within the 12-keyword strategy limit.`);
  if (keywords.length < 10) unknowns.push(`Only ${keywords.length} grounded keyword${keywords.length === 1 ? " is" : "s are"} supported by the available evidence, below the 10-keyword target; expand verified research before adding more.`);
  return { keywords, unknowns };
}
