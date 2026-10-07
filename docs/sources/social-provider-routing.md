# Reddit and X provider routing

Checked 7 October 2026. Provider access in application runtime still requires its own authenticated acceptance run; the TinyFish MCP Fetch receipt for public Reddit pages does not validate `TINYFISH_API_KEY` in the app.

## Reddit

TinyFish Search discovers canonical Reddit thread links, then free Fetch supplies public page excerpts. A search excerpt is labelled `preview`; fetched markdown is labelled `page_excerpt`. Preview documents carry `discoveryOnly: true`, which prevents preparing a reply from an indexed snippet. These are literal retrieval material, not an extracted original post. Missing publication dates remain missing. Only thread URLs on Reddit are accepted; identifiers come from the supplied canonical `/comments/` path.

An actual free-provider failure permits a read-only TinyFish Agent. It has at most 12 steps and 60 seconds and extracts public thread text plus at most five supplied existing replies. It does not sign in or access private communities. A provider failure there permits optional Scavio Reddit search. Successful empty results at every stage remain empty. Query sources may also specify a validated `subreddit` to target its public community.

Agent and Scavio requests use the common atomic paid gate with workspace attribution, provider opt-in and a configured daily budget. Gate denial and collection cancellation stop routing; they cannot cause another paid attempt or demo output. Free Search/Fetch retain zero-cost metering. Agent/Scavio calls are metered once by the paid gate.

The Agent reserves $0.192 using the existing project estimate of $0.016 per step and a 12-step cap. A supplied completed-run step count reconciles that estimate with the prior meter's minimum-one-step rule. Scavio reserves and records the existing approximate $0.004 per request. These unit rates still require account-receipt validation; supplied step counts alone do not establish the provider's dollar charge.

## X experiment

X acquisition uses the installed Scavio `client.x.search({ search, search_type, cursor })` contract. Records require literal retrieved text, a canonical X status URL with a numeric post ID, and a valid supplied publication timestamp. Model-written summaries never replace tweet text. Successful zero-result searches stay empty.

`X_GATEWAY_EXPERIMENT_ENABLED=true` optionally sends those acquired posts to the fixed Gateway `https://ai-gateway.vercel.sh/v1/responses` endpoint for read-only significance scores. The default model is `spacexai/grok-4.7`. `X_GATEWAY_MODEL` must name a verified model in the adapter allowlist. Acquisition provenance remains `scavio`; `significanceModel` identifies Grok separately. Significance output can refer only to the supplied canonical URLs and cannot edit literal post text. It does not post, reply or send messages.

Native Gateway X acquisition remains unverified. The [Gateway web-search guide](https://vercel.com/docs/ai-gateway/models-and-providers/web-search) distinguishes API-specific tool encodings and provider-specific support. The [Gateway Responses contract](https://vercel.com/docs/ai-gateway/sdks-and-apis/responses) documents text/structured output and `max_output_tokens`, but does not establish native `x_search`, per-item usage preservation or a server-side search budget bound. Focused primary-source searches for Gateway `x_search` and AI SDK `xSearch` with Gateway returned no compatible acquisition contract. A Gateway key alone therefore cannot provide fresh X discovery in this implementation.

The [SpaceXAI X Search contract](https://docs.x.ai/developers/tools/x-search) documents `x_search` on its own Responses endpoint and X search through its own SDK provider. As of 21 September 2026 it charges **$5 per 1,000 posts fetched and $10 per 1,000 user profiles fetched**, in addition to tokens, with `usage.server_side_tool_usage_details.x_posts_fetched` and `x_users_fetched`. [Tool usage details](https://docs.x.ai/developers/tools/tool-usage-details) state that `max_turns` caps turns, not individual parallel tool calls. Those facts do not prove that Gateway forwards the same native contract. No direct SpaceXAI API fallback is added.

The significance request enables no server tools and caps generated output at 2,048 tokens. Responses use a 96 KB streaming bound and a 30-second timeout. Its reservation uses a conservative input estimate and the verified model token rates; actual `usage.input_tokens` and `output_tokens` determine the single recorded cost when available. Known usage is settled before model output validation, so malformed claims still retain their token charge. Missing usage retains the explicit estimate. HTTP/provider failures are sanitized and retain the acquired Scavio material with failure metadata; budget denial and cancellation are terminal.

## Access and demo output

Missing credentials yield a sanitized access-pending error. Provider failures do not print upstream error bodies or secrets. Scavio request estimates retain the project's explicit approximate rates; they are estimates until reconciled with the account receipt. Current [Scavio documentation](https://scavio.dev/docs/) describes the SDK and public endpoint surface; installation is not authentication proof.

Fixtures require `VANTAGE_DEMO_FIXTURES=true` and are unavailable in production. They are used only without configured acquisition credentials. A configured provider's empty response or failure cannot silently turn into fixtures.

All client limits must be integers from 1 through 50; defaults are 20. Collectors propagate their abort signal, pagination cursor, content kind, top-comment evidence and actual provider provenance. A targeted Reddit source admits only links from its configured subreddit. Missing existing-reply evidence remains absent rather than claiming that no replies exist.

TinyFish SDK 0.7 provides Agent request cancellation through `agent.run(params, { signal })`. Its public Search/Fetch methods and the installed Scavio SDK have no in-flight cancellation parameter. Those calls use a 30-second HTTP timeout, disable automatic retries, and check cancellation before and after the request; cancellation prevents escalation. A remote request may still finish after cancellation, so any paid reservation remains conservative.
