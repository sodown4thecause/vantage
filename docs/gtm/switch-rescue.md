# Switch Rescue: two-week manual test (1 to 14 Nov 2026)

Source: Astra's report and the 6 Oct competitor review. Purpose: find out, by hand and before building more, whether people losing GummySearch, F5Bot or Reddit-RSS tooling will switch to Vantage and pay. Reddit RSS ends **13 Nov**; GummySearch lifetime access ends **30 Nov**.

**Everything here is done by the owner personally, from their own accounts, in their own words.** Agents prepared this kit only. No automation, no mass messaging, no AI-written messages or comments (Hacker News bans AI-generated text and several subreddits ban or restrict it).

## Pass/fail gates (decide by 14 Nov)
| Gate | Target |
|---|---|
| Completed rescues (their keywords running in Vantage, first leads delivered) | 3 |
| Activations (they opened leads or acted on one in the first week) | 2 |
| Founders paying (Pro $5 or credits) | 2 |

If fewer than 3 rescues are completed by 14 Nov, stop building acquisition features and revisit the offer.

## Who to approach (public signals only)
Only people who **publicly** said they are losing a tool or asked for an alternative:
- posts/comments asking for a "GummySearch alternative" or "F5Bot alternative", or complaining that Reddit RSS is ending;
- the competitors' own communities and issue trackers where users ask about alternatives (read-only; follow each venue's rules);
- people you already know from your own network.

Do not scrape contact details, buy lists, or message people who have not publicly asked. Before posting anywhere, re-read that venue's rules the same day (see `/rules` once the Rules Index ships, until then read the rules page yourself). Skip r/SaaS entirely.

## The offer (one paragraph, edit in your own voice)
"I'm building a free, open-source alternative that keeps watching Reddit and developer communities (HN, GitHub, Stack Overflow and more) for people asking about your category. If you send me your keyword list, I'll set it up for you and send the first leads within 24 hours. It's free to start, and Pro is $5 a month. I made it, so I'm biased." Always disclose you built it.

## Rescue procedure (target: first leads within 24 hours)
1. Ask for their keyword export or list (GummySearch CSV, F5Bot list, Syften queries) and what they sell.
2. Create their workspace or Monitor Pack (use the keyword importer once S15 ships; before that, enter keywords by hand and note every format or syntax problem; those notes drive the importer).
3. Run a scan; check the top results yourself; send them the top 5 with the evidence sentence.
4. Ask them to reply with which ones were useful (this feeds the outcomes metric).
5. Offer Pro only after they have seen leads. Pro is $5/month; credits are optional.
6. Record everything in the tracking sheet the same day.

## Tracking sheet
Copy `docs/gtm/switch-rescue-tracking.csv` and fill one row per person. Columns:

| Column | Meaning |
|---|---|
| `id` | short label you choose (no personal data needed) |
| `source_tool` | gummysearch, f5bot, syften, reddit_rss, other |
| `found_via` | where you found the public ask (venue name, not a link to a private message) |
| `contacted_on` | date |
| `rescued_on` | date their keywords were running and first leads sent (blank if not) |
| `activated` | yes/no: acted on or opened at least one lead in week one |
| `paying` | yes/no |
| `founder_minutes` | your time spent |
| `provider_cost_usd` | from the cost ledger for their workspace |
| `notes` | what broke, which keyword syntax could not be imported, what they asked for |

Summarize with `pnpm tsx scripts/gtm/summarize.ts docs/gtm/switch-rescue-tracking.csv` (prints gate status, founder time and cost per rescue).

## No-spam checklist (tick before each message)
- [ ] They publicly asked or complained about this exact problem.
- [ ] I am writing this message myself, specific to their situation.
- [ ] I disclosed that I built Vantage.
- [ ] The venue allows this kind of reply (checked today).
- [ ] I am not sending the same text to multiple people.
- [ ] If they say no or do not answer, I stop.

## Collecting real keyword exports (for the importer)
With permission, keep 5 to 10 anonymized exports (keywords only, no names) so the parsers in slice S15 are tested on real formats. Store them outside the repo; commit only synthetic examples.
