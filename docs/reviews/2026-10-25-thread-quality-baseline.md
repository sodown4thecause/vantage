# Thread quality fixture baseline

Recorded 2026-10-26 against `lib/opportunities/features.ts`, `lib/opportunities/run.ts`, and `lib/pipeline/intent-ladder.ts`. This is an offline synthetic characterization, not a historical incident reproduction or a production quality score.

## Corpus and labels

`test/fixtures/thread-relevance.json` contains 20 authored synthetic examples, ten per split. Every case identifies its synthetic provenance and uses the reserved `example.com` domain; none is a fetched HN or Reddit post. No authorised historical mismatch, provider response, private customer content, credentials, or database was available. Historical reproduction remains unavailable.

Development uses Postgres recovery questions; acceptance uses keyboard accessibility questions with different bodies, replies, and URLs. Both contain an unresolved expertise question without buying intent, a relevant HN question, an unrelated HN keyword collision, hostile source instructions, an already-answered thread, and preview/deleted/locked/unavailable/replies-unavailable contexts. Empty replies with `complete` means no observed replies; empty replies with `replies_unavailable` means unknown conversation history, not an unanswered question.

`recommend` means a useful contribution exists and the user may adapt and submit a suggestion themselves; it never authorises automatic posting. HN has no `recommend` labels: relevant HN material is `research_only` under the task policy. `reject` covers unrelated, hostile, resolved, or deleted material. `research_only` also means abstain from reply suggestions while context or participation is unavailable. These labels are the intended future gate contract, not assertions that the existing system implements it.

Use only development for prompt, threshold, and gate tuning. Acceptance is reserved for independent final evaluation after tuning is frozen. This change validates acceptance schema and coverage only; no acceptance scores or model outputs were generated. Fixture validation is not a relevance classifier or an automated judge of label correctness. Review the actual text and labels independently before Plan 3 calibration.

## Measured keyword seam

Only the ten development cases were passed directly to the current pure `computeFeatures` and `decideStatus` functions. Adapter: one `NormalizedDocument` per case, empty title, `thread.text` as text, synthetic workspace/hash, fixture URL/platform, `postedAt = 2026-10-26T00:00:00Z`, and `Date.now` fixed to that same instant. Profile adapter: `productDescription = profile.domain`, `topics = profile.expertise`, `competitors = []`. No semantic signals, preferences, replies, context-state enrichment, live clustering, database, providers, or network were involved. The profile adapter intentionally cannot express audience/exclusions to this existing signature.

An ephemeral local TypeScript script imported those two functions and read only rows with `split === "development"`; `pnpm exec tsx .relevance-baseline-tmp.ts` exited 0 with these results. The script was removed after measurement.

| Development case suffix | Fit | Intent | Low confidence | Existing status |
| --- | ---: | ---: | --- | --- |
| expertise-question | 1 | 0 | true | review |
| hn-expertise | 1 | 0.5 | false | monitor |
| keyword-collision | 0.75 | 1 | false | monitor |
| hostile-instructions | 0.75 | 1 | false | monitor |
| already-answered | 0.75 | 0.5 | false | monitor |
| preview | 0.75 | 0 | true | review |
| deleted | 0.75 | 0 | true | review |
| locked | 0.5 | 0 | true | review |
| unavailable | 0.5 | 0 | true | review |
| replies-unavailable | 0.75 | 0.5 | false | monitor |

The baseline assigns non-ignore status even to the authored hard negatives and insufficient-context cases. The expertise question receives fit 1 but intent 0 and review status. These observations establish missing distinctions at this pure seam; they do not show a live queue recommendation, a generated reply, historical provider behavior, or an accuracy rate. Existing statuses cannot be equated to the three fixture labels.

## Integration seam and stored candidates

`buildOpportunities` reads recent live workspace documents, normalizes them, obtains optional semantic signals, clusters, then calls `computeFeatures` and `decideStatus` per cluster. The fit calculation combines token overlap with optional semantic fit by taking the maximum; semantic intent can raise but cannot lower keyword intent. Neither pure scorer receives replies, context-state, audience, or exclusions. This identifies the place Plan 3 must supply richer evidence and a relevance/contribution gate before promoting a candidate into a suggested opportunity. Scoring alone cannot fix a source-policy or reply-context decision.

Current persistence upserts clusters and evidence even when status is `ignore`. `listOpportunityQueue` filters statuses to opportunity/monitor/review, requires the latest profile version and live workspace evidence, and limits to five cards. Stored documents and opportunity rows therefore do not establish that a thread was recommended. Replies appear later in `getOpportunityDetail` from topComments/topReplies metadata; normalization does not put them into the scoring input. A future candidate/recommendation separation must preserve raw evidence for research while preventing rejected, unresolved-context, or HN-policy cases from being promoted as reply suggestions. This change adds no gate or product behavior.

## Verification and limits

The focused fixture suite checks strict schema, nonempty profiles/content, synthetic provenance, reserved URLs, unique identities/URLs/normalized bodies, disjoint reply content between splits, required case categories in each split, non-buying-intent positives, HN policy, and abstention on incomplete context. Its absent-corpus RED run failed all five tests, including the explicit `labelled relevance corpus must exist` assertion. GREEN passed all five after adding the corpus. These are data-contract checks, not measured model relevance, policy enforcement, or live product acceptance.

No paid inference, provider calls, historical reproduction, staging journey, or acceptance model evaluation was performed. Plan 3 owns classifier/gate implementation and independent acceptance enforcement.
