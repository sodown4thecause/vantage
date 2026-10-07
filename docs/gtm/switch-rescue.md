# Switch Rescue: two-week manual test (1 to 14 Nov 2026)

Source: Astra's report and the 6 Oct 2026 competitor review (dates below are as of 6 Oct; **verify each against the primary source before repeating it to anyone**: TechCrunch and PPC Land on Reddit's API/RSS shutdown, GummySearch's own closing notice). Purpose: find out, by hand and before building more, whether people losing GummySearch, F5Bot or Reddit-RSS tooling will switch to Vantage and pay. Reddit RSS ends **13 Nov**; GummySearch lifetime access ends **30 Nov**.

**Everything here is done by the owner personally, from their own accounts, in their own words.** Agents prepared this kit only. No automation, no mass messaging, no AI-written messages or comments (Hacker News bans AI-generated text and several subreddits ban or restrict it).

## Pass/fail gates (decide by 14 Nov)
| Gate | Target |
|---|---|
| Completed rescues (their keywords running in Vantage, first leads delivered) | 3 |
| Activations (they opened leads or acted on one in the first week) | 2 |
| Founders paying (Pro $5 or credits) | 2 |

If fewer than 3 rescues are completed by 14 Nov, stop building acquisition features and revisit the offer.

**Enrollment closes 7 Nov.** A rescue completed after 7 Nov cannot have a full first week by the 14 Nov decision, so it counts toward the rescues gate but its `activated` value is *pending*, not a failure: when deciding, evaluate the activation gate only over rescues with `rescued_on` on or before 7 Nov, and note pending ones in `notes` (the summary script counts all unactivated rescues as not activated, so read its output with this in mind). If you want a full week of observation for late rescues, move the decision date instead of counting them as failures.

## Who to approach (public signals only)
Only people who **publicly** said they are losing a tool or asked for an alternative:
- posts/comments asking for a "GummySearch alternative" or "F5Bot alternative", or complaining that Reddit RSS is ending;
- the competitors' own communities and issue trackers where users ask about alternatives (read-only; follow each venue's rules);
- people you already know from your own network.

Do not scrape contact details, buy lists, or message people who have not publicly asked. Before posting anywhere, re-read that venue's rules the same day (see `/rules` once the Rules Index ships, until then read the rules page yourself). Skip r/SaaS entirely (it banned promoting tools that detect opportunities or generate promotional replies, June 2026; breaking the rule can get you banned and the tool's URL blacklisted).

## What to cover in your own message (facts to cover, not a template to paste)
Write each message yourself, specific to the person. Cover these points, **but only the ones that are true on the day you send it**:

- **Who you are and that you built it** ("I made this, so I'm biased").
- **What it does today.** List only the sources you have personally seen running in production that day. As of 6 Oct 2026 the scheduled scan only runs Hacker News, RSS and Substack; Reddit, GitHub and Stack Overflow are planned (slices S11, S13, S14), so do not promise them until they are live. If some are still being added, say so.
- **"Free to start".** Do not say "free" and "$5 Pro" as if they were one offer. Say what is free now and that a paid plan is planned or available.
- **"Open source"** only if the repository is public and has a LICENSE file when you send the message (there is none as of 6 Oct 2026). Otherwise leave the word out.
- **Payment.** Stripe billing (slice S40) is not built yet. If you want to test the "paying" gate before it ships, say plainly that you will take payment manually (for example a payment link) and record it as such. Otherwise the paying gate cannot be met.
- **What you will do for them:** set up their keywords and send the first leads within 24 hours.

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
| `found_via` | where you found the public ask (venue name only) |
| `contacted_on` | date |
| `rescued_on` | `YYYY-MM-DD` date their keywords were running and first leads sent; **leave blank if not rescued** (anything else is rejected) |
| `activated` | `yes` or `no`: acted on or opened at least one lead in week one |
| `paying` | `yes` or `no` |
| `founder_minutes` | your time spent |
| `provider_cost_usd` | from the cost ledger for their workspace |
| `notes` | what broke, which keyword syntax could not be imported, what they asked for |

**No names, handles, emails or links in any column** (`id` is a label you choose, and each id must be unique; log follow-ups in `notes`). Summarize with `pnpm tsx scripts/gtm/summarize.ts docs/gtm/switch-rescue-tracking.csv` (prints gate status, founder time and cost per rescue). The script rejects the sheet and lists every problem for: empty or duplicate ids, a `rescued_on` that does not match `YYYY-MM-DD`, `activated`/`paying` values other than yes/no (it also accepts y/n, true/false and 1/0), and negative or non-numeric minutes/cost. It does **not** reject these, so fill them in deliberately: blank `activated`/`paying` count as no, blank `founder_minutes`/`provider_cost_usd` count as 0 (which understates time and cost), and a date that matches the format but does not exist (for example 2026-02-31) is accepted.

## No-spam checklist (tick before each message)
- [ ] They publicly asked or complained about this exact problem.
- [ ] I am writing this message myself, specific to their situation.
- [ ] I disclosed that I built Vantage.
- [ ] The venue allows this kind of reply (checked today).
- [ ] I am not sending the same text to multiple people.
- [ ] If they say no or do not answer, I stop.

## Collecting real keyword exports (for the importer)
With permission, keep 5 to 10 anonymized exports (keywords only, no names) so the parsers in slice S15 are tested on real formats. Store them outside the repo; commit only synthetic examples.
