/**
 * Self-promotion rule per subreddit, read from each community's public rules on 2026-10-23.
 * Stored here so the reply screen never fetches Reddit live. A policy is only recorded when the
 * classifier was confident and the keyword check did not disagree; everything else is "unclear"
 * and the screen sends the owner to the rules page. Rules change, so the checked date is shown.
 */
export type SubredditPolicy = "never" | "allowed_with_disclosure" | "designated_thread_only" | "unclear";

export type SubredditRule = { name: string; policy: SubredditPolicy; rulesUrl: string; checked: string };

export const SUBREDDIT_RULES: Record<string, SubredditRule> = {
  "saas": { name: "SaaS", policy: "unclear", rulesUrl: "https://www.reddit.com/r/SaaS/about/rules/", checked: "2026-10-23" },
  "startups": { name: "startups", policy: "unclear", rulesUrl: "https://www.reddit.com/r/startups/about/rules/", checked: "2026-10-23" },
  "sideproject": { name: "SideProject", policy: "unclear", rulesUrl: "https://www.reddit.com/r/SideProject/about/rules/", checked: "2026-10-23" },
  "indiehackers": { name: "indiehackers", policy: "allowed_with_disclosure", rulesUrl: "https://www.reddit.com/r/indiehackers/about/rules/", checked: "2026-10-23" },
  "microsaas": { name: "microsaas", policy: "allowed_with_disclosure", rulesUrl: "https://www.reddit.com/r/microsaas/about/rules/", checked: "2026-10-23" },
  "buildinpublic": { name: "buildinpublic", policy: "unclear", rulesUrl: "https://www.reddit.com/r/buildinpublic/about/rules/", checked: "2026-10-23" },
  "entrepreneur": { name: "Entrepreneur", policy: "never", rulesUrl: "https://www.reddit.com/r/Entrepreneur/about/rules/", checked: "2026-10-23" },
  "smallbusiness": { name: "smallbusiness", policy: "unclear", rulesUrl: "https://www.reddit.com/r/smallbusiness/about/rules/", checked: "2026-10-23" },
  "webdev": { name: "webdev", policy: "unclear", rulesUrl: "https://www.reddit.com/r/webdev/about/rules/", checked: "2026-10-23" },
  "programming": { name: "programming", policy: "never", rulesUrl: "https://www.reddit.com/r/programming/about/rules/", checked: "2026-10-23" },
  "experienceddevs": { name: "ExperiencedDevs", policy: "unclear", rulesUrl: "https://www.reddit.com/r/ExperiencedDevs/about/rules/", checked: "2026-10-23" },
  "devops": { name: "devops", policy: "unclear", rulesUrl: "https://www.reddit.com/r/devops/about/rules/", checked: "2026-10-23" },
  "selfhosted": { name: "selfhosted", policy: "allowed_with_disclosure", rulesUrl: "https://www.reddit.com/r/selfhosted/about/rules/", checked: "2026-10-23" },
  "nextjs": { name: "nextjs", policy: "unclear", rulesUrl: "https://www.reddit.com/r/nextjs/about/rules/", checked: "2026-10-23" },
  "reactjs": { name: "reactjs", policy: "unclear", rulesUrl: "https://www.reddit.com/r/reactjs/about/rules/", checked: "2026-10-23" },
  "node": { name: "node", policy: "unclear", rulesUrl: "https://www.reddit.com/r/node/about/rules/", checked: "2026-10-23" },
  "typescript": { name: "typescript", policy: "unclear", rulesUrl: "https://www.reddit.com/r/typescript/about/rules/", checked: "2026-10-23" },
  "localllama": { name: "LocalLLaMA", policy: "allowed_with_disclosure", rulesUrl: "https://www.reddit.com/r/LocalLLaMA/about/rules/", checked: "2026-10-23" },
  "claudeai": { name: "ClaudeAI", policy: "allowed_with_disclosure", rulesUrl: "https://www.reddit.com/r/ClaudeAI/about/rules/", checked: "2026-10-23" },
  "chatgptcoding": { name: "ChatGPTCoding", policy: "designated_thread_only", rulesUrl: "https://www.reddit.com/r/ChatGPTCoding/about/rules/", checked: "2026-10-23" },
  "cursor": { name: "cursor", policy: "unclear", rulesUrl: "https://www.reddit.com/r/cursor/about/rules/", checked: "2026-10-23" },
  "openai": { name: "OpenAI", policy: "allowed_with_disclosure", rulesUrl: "https://www.reddit.com/r/OpenAI/about/rules/", checked: "2026-10-23" },
  "singularity": { name: "singularity", policy: "never", rulesUrl: "https://www.reddit.com/r/singularity/about/rules/", checked: "2026-10-23" },
  "machinelearning": { name: "MachineLearning", policy: "unclear", rulesUrl: "https://www.reddit.com/r/MachineLearning/about/rules/", checked: "2026-10-23" },
  "artificial": { name: "artificial", policy: "unclear", rulesUrl: "https://www.reddit.com/r/artificial/about/rules/", checked: "2026-10-23" },
  "n8n": { name: "n8n", policy: "never", rulesUrl: "https://www.reddit.com/r/n8n/about/rules/", checked: "2026-10-23" },
  "automation": { name: "automation", policy: "allowed_with_disclosure", rulesUrl: "https://www.reddit.com/r/automation/about/rules/", checked: "2026-10-23" },
  "ai_agents": { name: "AI_Agents", policy: "allowed_with_disclosure", rulesUrl: "https://www.reddit.com/r/AI_Agents/about/rules/", checked: "2026-10-23" },
  "promptengineering": { name: "PromptEngineering", policy: "unclear", rulesUrl: "https://www.reddit.com/r/PromptEngineering/about/rules/", checked: "2026-10-23" },
  "marketing": { name: "marketing", policy: "never", rulesUrl: "https://www.reddit.com/r/marketing/about/rules/", checked: "2026-10-23" },
  "seo": { name: "SEO", policy: "unclear", rulesUrl: "https://www.reddit.com/r/SEO/about/rules/", checked: "2026-10-23" },
  "bigseo": { name: "bigseo", policy: "never", rulesUrl: "https://www.reddit.com/r/bigseo/about/rules/", checked: "2026-10-23" },
  "juststart": { name: "juststart", policy: "never", rulesUrl: "https://www.reddit.com/r/juststart/about/rules/", checked: "2026-10-23" },
  "alphaandbetausers": { name: "alphaandbetausers", policy: "unclear", rulesUrl: "https://www.reddit.com/r/alphaandbetausers/about/rules/", checked: "2026-10-23" },
  "softwareengineering": { name: "SoftwareEngineering", policy: "unclear", rulesUrl: "https://www.reddit.com/r/SoftwareEngineering/about/rules/", checked: "2026-10-23" },
  "datascience": { name: "datascience", policy: "allowed_with_disclosure", rulesUrl: "https://www.reddit.com/r/datascience/about/rules/", checked: "2026-10-23" },
};

export type RuleLine = { text: string; url: string | null; checked: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatChecked(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Reddit subreddit name from the collector metadata or, failing that, the thread URL. */
export function subredditOf(urlCanonical: string, subreddit?: string | null): string | null {
  const named = subreddit?.trim().replace(/^r\//i, "");
  if (named && /^[A-Za-z0-9_]{2,21}$/.test(named)) return named;
  try {
    const url = new URL(urlCanonical);
    if (!/(^|\.)reddit\.com$/i.test(url.hostname)) return null;
    return url.pathname.match(/^\/r\/([A-Za-z0-9_]{2,21})(?:\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

const POLICY_TEXT: Record<SubredditPolicy, (name: string) => string> = {
  never: (name) => `r/${name} does not allow self-promotion. Reply to help, not to pitch.`,
  allowed_with_disclosure: (name) => `r/${name} allows self-promotion only if you say who you are.`,
  designated_thread_only: (name) => `r/${name} only allows promotion in its designated threads.`,
  unclear: (name) => `We could not read r/${name}'s self-promotion rule with confidence. Check it before you reply.`,
};

/** One-line rules reminder for a conversation. Never calls the network. */
export function ruleLineFor(urlCanonical: string, subreddit?: string | null): RuleLine {
  const name = subredditOf(urlCanonical, subreddit);
  if (!name) return { text: "Check this community's rules before you reply.", url: null, checked: null };
  const key = name.toLowerCase();
  const rule = Object.hasOwn(SUBREDDIT_RULES, key) ? SUBREDDIT_RULES[key] : undefined;
  if (!rule) {
    return { text: `We have no stored rule for r/${name} yet. Check its rules before you reply.`, url: `https://www.reddit.com/r/${name}/about/rules/`, checked: null };
  }
  return { text: POLICY_TEXT[rule.policy](rule.name), url: rule.rulesUrl, checked: formatChecked(rule.checked) };
}
