/**
 * Public forums grouped by audience. A profile searches the packs its own words point at, so a
 * marketing product reads marketing communities instead of developer ones. Dependency-free.
 */

/** Public developer and founder forums readable without an account. HN, Reddit and Stack Overflow have their own collectors. */
export const DEVELOPER_FORUM_DOMAINS = [
  "dev.to",
  "indiehackers.com",
  "lobste.rs",
  "community.openai.com",
  "discuss.huggingface.co",
  "community.cloudflare.com",
  "community.vercel.com",
  "forum.cursor.com",
  "community.n8n.io",
  "discuss.python.org",
  "users.rust-lang.org",
  "forum.freecodecamp.org",
  "community.fly.io",
  "discuss.elastic.co",
] as const;

export type ForumPackId = "developer" | "marketing" | "ecommerce" | "founders";

export type ForumPack = {
  label: string;
  domains: readonly string[];
  /** Matched as whole words or phrases against a lower-cased profile. */
  keywords: readonly string[];
};

/** Insertion order is the order domains are picked in. */
export const FORUM_PACKS: Record<ForumPackId, ForumPack> = {
  developer: {
    label: "Developer communities",
    domains: DEVELOPER_FORUM_DOMAINS,
    keywords: ["developer", "developers", "api", "sdk", "devtools", "dev tools", "open source", "llm", "ai agent",
      "agents", "coding", "code", "programming", "framework", "database", "devops", "infrastructure"],
  },
  marketing: {
    label: "Marketing and SEO",
    domains: ["community.hubspot.com", "warriorforum.com", "webmasterworld.com", "indiehackers.com"],
    keywords: ["seo", "aeo", "geo", "marketing", "marketer", "social listening", "lead generation", "leads", "growth",
      "content", "brand", "advertising", "ads", "email marketing", "backlinks", "outreach", "buying intent"],
  },
  ecommerce: {
    label: "E-commerce",
    domains: ["community.shopify.com", "indiehackers.com"],
    keywords: ["ecommerce", "e-commerce", "shopify", "online store", "store owners", "dropshipping", "woocommerce",
      "merchants", "amazon sellers"],
  },
  founders: {
    label: "Founders and SaaS",
    domains: ["indiehackers.com", "dev.to"],
    keywords: ["saas", "startup", "startups", "founder", "founders", "indie", "bootstrapped", "side project", "mrr", "b2b"],
  },
};

/** Every known forum, de-duplicated. Blog searches exclude all of them. */
export const ALL_FORUM_DOMAINS: readonly string[] = [
  ...new Set(Object.values(FORUM_PACKS).flatMap(pack => pack.domains)),
];

const MAX_PICKED_DOMAINS = 20;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MATCHERS = Object.values(FORUM_PACKS).map(pack => ({
  domains: pack.domains,
  patterns: pack.keywords.map(keyword => new RegExp(`\\b${escapeRegExp(keyword)}\\b`)),
}));

/**
 * Domains for the packs whose keywords appear in the profile text, in pack order, de-duplicated and capped.
 * With no keyword match the developer pack is returned, which is the forum list searched before packs existed.
 */
export function pickForumDomains(profileText: string): string[] {
  const text = profileText.toLowerCase().replace(/\s+/g, " ");
  const picked = new Set<string>();
  for (const matcher of MATCHERS) {
    if (!matcher.patterns.some(pattern => pattern.test(text))) continue;
    for (const domain of matcher.domains) picked.add(domain);
  }
  if (!picked.size) return [...DEVELOPER_FORUM_DOMAINS];
  return [...picked].slice(0, MAX_PICKED_DOMAINS);
}
