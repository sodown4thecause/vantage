# Public developer community collection

The catalog installs one source at a time. Choose sources that fit the workspace's source limit: a useful three-source starter is Hacker News AI coding, DEV.to AI, and LangGraph GitHub issues. Add a Stack Overflow source or replace a broader feed when troubleshooting questions matter more. Nothing in the catalog bulk-provisions sources.

## Free and public sources

GitHub uses the [official issues search API](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28#search-issues-and-pull-requests) with `is:public is:issue`, at most two pages per query and three queries. It samples recently updated issues and records original creation timestamps. No account token, private repository access, or per-issue enrichment is required. [GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) apply to the shared outbound IP; a rate-limited response stops the run.

Stack Overflow uses the [Stack Exchange advanced-search API](https://api.stackexchange.com/docs/advanced-search), bounded to two pages. Optional answer enrichment is one batch for at most five questions, so supplied replies can help identify an unanswered contribution gap. [API backoff](https://api.stackexchange.com/docs/throttle) stops additional requests and persists the next permitted time in the cursor. This source supports research briefs only: [Stack Overflow's AI policy](https://stackoverflow.com/help/ai-policy) prohibits AI-generated contributions. [Hacker News guidelines](https://news.ycombinator.com/newsguidelines.html) also prohibit generated or edited AI text.

Feeds use the existing public RSS/Atom collector. The response limit defaults to 512 KB; an explicit `maxResponseBytes` source setting can raise it to a hard 3 MB ceiling, enforced while streaming. The three catalog newsletters measured above 512 KB opt into that ceiling. Substack forwards this setting to the RSS collector. Only public posts and RSS-visible previews are collected; paywalled bodies and authenticated communities are excluded. Rules links are review entry points. A catalog link does not prove permission to post or promote a product.

The following feeds were fetched publicly on 7 October 2026 and returned XML with entries. This verifies source availability, not application credentials or a deployed collection run.

| Feed | Receipt |
|---|---|
| [DEV.to AI](https://dev.to/feed/tag/ai) | HTTP 200, 12 entries; 143,909 bytes |
| [DEV.to LLM](https://dev.to/feed/tag/llm) | HTTP 200, 12 entries; 202,002 bytes |
| [DEV.to LangChain](https://dev.to/feed/tag/langchain) | HTTP 200, XML feed; 330,019 bytes |
| [Lobsters](https://lobste.rs/rss) | HTTP 200, 17,609 bytes |
| [Hugging Face blog](https://huggingface.co/blog/feed.xml) | HTTP 200, 258,351 bytes; within the collector's 512 KB response limit |
| [Simon Willison](https://simonwillison.net/atom/everything/) | HTTP 200, 30 entries |
| [Hugging Face forums](https://discuss.huggingface.co/latest.rss) | HTTP 200, 30 entries |
| [OpenAI developer forum](https://community.openai.com/latest.rss) | HTTP 200, 30 entries |
| [Latent Space](https://www.latent.space/feed) | HTTP 200, 15 entries; 1,178,687 bytes; 3 MB opt-in |
| [Ahead of AI](https://magazine.sebastianraschka.com/feed) | HTTP 200, 6 entries; 2,706,095 bytes; 3 MB opt-in |
| [Import AI](https://importai.substack.com/feed) | HTTP 200, 20 entries; 464,633 bytes |
| [Interconnects](https://www.interconnects.ai/feed) | HTTP 200, 20 entries; 541,942 bytes; 3 MB opt-in |

LangChain's former `https://blog.langchain.com/rss/` returned HTML rather than a feed during the check and is excluded. Reddit catalog entries identify public communities for the TinyFish/Scavio lane; their presence does not enable schedules or bypass the provider gate.

## Alexandria dataset discovery

The [Firecrawl scrape API](https://docs.firecrawl.dev/api-reference/endpoint/scrape) accepts `POST https://api.firecrawl.dev/v2/scrape` with an `alexandria` object or array. Live, zero-credit `find-tools` discovery verified this allowlist on 7 October 2026:

| Contract | Allowed request | Price discovered |
|---|---|---|
| [firecrawl-developer-index/search](https://www.firecrawl.dev/alexandria/firecrawl-developer-index) | `query`, bounded `k`, `passages`, optional `types` and `repos` | 2 credits per 10 records |
| github-com/repositories/issues | validated public `owner/repo`, `state`, `sort`, `direction`, `page`, `per_page`, bounded labels; pull requests excluded | 5 credits per request |

Both require `FIRECRAWL_API_KEY`, a positive `FIRECRAWL_CREDIT_USD` conversion, explicit paid-provider enablement and the shared atomic daily budget. Credit prices came from live provider contracts, not a dollar-pricing assumption. Execution records actual returned credits when supplied, otherwise the reserved estimate. No dataset execution was needed for contract discovery. Source results retain provider provenance and canonical URLs; developer-index passages are marked discovery material, not buying-intent proof. Missing publication dates stay null. Partial results remain labelled partial.

## LinkedIn indexed discovery

[Scavio Google Search](https://scavio.dev/docs/search-api) exposes public indexed results with `title`, `link`, and `snippet`. LinkedIn collection uses a `site:linkedin.com/posts/` query and accepts only LinkedIn post/activity URLs. Coverage is labelled **partial indexed public snippets**. It does not fetch a LinkedIn login wall, profile, private group, full post body, or comments. Search snippets supply no reliable publication time, so timestamps stay null.

The official `scavio@0.16.0` npm package was inspected: `LinkedInNamespace.searchPosts` exists but is explicitly retired upstream, always returns HTTP 410, and is never billed. The [current LinkedIn API page](https://scavio.dev/linkedin-api) confirms nine live endpoints and five retired ones. Post detail/comments and configured person/company feeds exist, but they do not replace broad keyword discovery. The SDK's request configuration exposes timeout/retries without `AbortSignal`; the collector uses the same documented Google HTTP contract through the existing abortable public-fetch helper.

This lane requires `SCAVIO_API_KEY`, a positive explicit `SCAVIO_GOOGLE_COST_USD` estimate, paid-provider enablement and the shared budget gate. Google discovery cost must be configured rather than inferred from Scavio's Reddit price. Successful empty results remain empty. Provider errors and unavailable access remain visible to operators.

All new collectors propagate aborts, bound response sizes, avoid fixture fallbacks, and use stable source URLs. Public API requests keep the default four-second HTTP timeout and are recorded through the existing cost meter at the zero-cost fallback price. Alexandria and indexed LinkedIn requests explicitly allow up to 30 seconds; the caller's combined abort signal can stop them sooner. Paid calls pass through `runPaidCall` before contacting a provider. Automated scans continue to use only the free allowlist controlled by the application.
