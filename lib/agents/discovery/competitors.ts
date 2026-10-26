import { isPublicHttpUrl } from "@/lib/http/public-fetch";
import type { ResearchEvidence } from "./types";

export type DiscoveryCompetitor = { domain: string; positioning: string; evidenceIds: string[] };

function supportedWords(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])]
    .filter(word => !["the", "and", "for", "with", "from", "that", "this", "are", "you", "your", "our", "their", "into", "can", "will", "has", "have", "not"].includes(word));
}

function mentionsExactDomain(text: string, domain: string): boolean {
  const escaped = domain.split(".").join("\\.");
  return new RegExp(`(?:^|[^a-z0-9.-])(?:www\\.)?${escaped}(?=$|[^a-z0-9.-])`, "i").test(text);
}

function hasExactWords(text: string, words: string[]): boolean {
  const available = new Set(supportedWords(text));
  return words.length > 0 && words.every(word => available.has(word));
}

function sameDomain(left: string, right: string): boolean {
  try { return new URL(left).hostname.replace(/^www\./i, "").toLowerCase() === right.replace(/^www\./i, "").toLowerCase(); }
  catch { return false; }
}

/** Names are suggestions only when the cited full page itself identifies the domain and positioning. */
export function groundCompetitors(candidates: DiscoveryCompetitor[], evidence: ResearchEvidence[], productUrl: string): { competitors: DiscoveryCompetitor[]; unknowns: string[] } {
  const byId = new Map(evidence.map(item => [item.id, item]));
  const competitors: DiscoveryCompetitor[] = [];
  const unknowns: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const domain = candidate.domain.toLowerCase();
    if (seen.has(domain)) continue;
    seen.add(domain);
    const references = candidate.evidenceIds.map(id => byId.get(id)!);
    if (sameDomain(productUrl, domain)) {
      unknowns.push(`Competitor ${domain} was not proposed because it is the product's own domain.`);
      continue;
    }
    const positionWords = supportedWords(candidate.positioning);
    const identityAndPositionEvidence = references.some(item =>
      (mentionsExactDomain(item.excerpt, domain) || sameDomain(item.url, domain)) &&
      hasExactWords(item.excerpt, positionWords));
    if (!isPublicHttpUrl(`https://${domain}/`) || !identityAndPositionEvidence) {
      unknowns.push(`Competitor ${domain} remains unknown because its identity or positioning is not verified by the cited pages.`);
      continue;
    }
    competitors.push({ ...candidate, domain });
  }
  return { competitors, unknowns };
}
