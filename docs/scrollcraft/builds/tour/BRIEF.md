# BRIEF: /tour, the workspace tour

Self-authored under explicit creative delegation. The founder asked for "an
immersive front end design, as the user scrolls down show the user journey. An
AI based GTM/SEO/GEO workspace for AI and developer tools. Show conversation on
reddit, X, forums, SEO/GEO features with GSC integration and humanizer plugin
for content." Everything below that is not a quote is an authored decision.

## The eight topics

1. **Vibe.** A tool that is already working when you arrive. Calm, exact,
   slightly dry. References: a well-kept lab notebook; a flight strip board; a
   red-pen edit on a printed draft.
2. **The journey, in the founder's words.** "Show the user journey": the
   conversations on Reddit, X and forums, then the SEO/GEO side with Search
   Console, then the humanizer working on content.
3. **Energy.** Quiet open, a burst of numbers as the noise is filtered, a calm
   reading section, a lateral sweep across search engines, the loudest moment
   at the edit pass, then quiet again at the input.
4. **Feeling, and the one moment.** See the curve below. The moment: the draft
   rewriting itself under the reader's scroll.
5. **What no other site does.** The scroll is the editor: each AI tell in a
   draft is marked, named and replaced as you scroll, and the edit log fills.
6. **Range.** Dense, information-forward, in the product's own "survey sheet"
   palette. Not premium-minimal, not dark-by-default.
7. **One world or scenes.** Scenes: each section is a different panel of the
   same workspace. No continuous camera flight.
8. **Assets.** None beyond the product's own tokens, type and score glyph. No
   generated imagery: the surface is real markup computing from data arrays.

## Grammar

**Live surface.** The honest pitch is "watch what it does", and the product is
a working surface. The page has app chrome (a sidebar that is the navigation),
copy in the surface's idiom, and closes on a real input. The demo workspace and
every number in it are labelled as sample data on the page.

Why the other seven lost: filmic one-shot and continuous world need footage of
a place, and this product has no place; chaptered editorial would describe the
product instead of operating it; typographic poster and rhythmic cutlist suit a
brand with one loud claim, not a workflow; gallery is for a range of objects;
split stage needs a two-sided argument, and "manual vs. automated" would make
one column a straw man.

## Journey

1. Recognition: the queue is already sorted when you arrive.
2. Relief: thousands of posts become five.
3. Conviction: the evidence behind the top conversation.
4. Ownership: you write the reply; there is no post button.
5. Discovery: the same question in Search Console and AI answers, and a gap.
6. Delight: a draft for the gap, edited until it sounds like a person.
7. Readiness: describe your product and see what would be watched.

## Feeling curve

```
1  Recognition  the queue already in state, the top card lifting off the list, the raw stream receding behind it
2  Relief       counters run on ten sources and collapse 2,140 posts to 5
3  Conviction   a Reddit post, an X reply and an HN comment arrive one by one while the score glyph fills
4  Ownership    an empty composer with a cursor, a suggested approach, and no post button anywhere
5  Discovery    a sideways sweep across Search Console and three AI engines that ends on an uncited query
6  Delight      the draft edits itself under the reader's hand; every tell is named, then replaced
7  Readiness    a field with a cursor; the reader's own words return the communities that would be read
```

## The peak

"There's a part where you scroll and it edits an AI draft line by line until it
sounds like a person, and it tells you what each fix was." Act 6. It has the
largest span (4.0 viewport-heights) and follows the calmest-moving act.

## Tell-someone sentence

It's the site where scrolling runs a morning in the workspace, and the draft at
the end gets edited until it sounds like you.

## Authored silence

None. Every act changes something on screen for its whole span.

## Score

| Act | Beat | Device | Span | Why |
|---|---|---|---|---|
| Queue | Recognition | `pin` + `parallax` planes | 1.8 | Depth from three planes moving at different rates, holding long enough to read |
| Sources | Relief | `flow` + `count` | flow | Numbers driven by the section's own travel; no pin, so it does not repeat the hero |
| Opportunity | Conviction | `pin` + `cue`, glyph from `--sc-p` | 2.0 | Evidence must arrive in order while the frame holds |
| Reply | Ownership | `flow` + `reveal` | flow | A wipe opens the composer: a change of state |
| Search | Discovery | `pan` | 3.0 | Lateral travel reads as "across engines" |
| Content | Delight (peak) | `pin` + signature edit pass | 4.0 | The largest span; the scroll is the editor |
| Start | Readiness | `flow` + live input | flow | The page stops moving and starts answering |

Seven acts, about 14.2 viewport-heights including the flow sections. No device
family twice in a row; no `scrub`, `kinetic`, `spotlight` or `drift` (banned by
the grammar).

## Honesty notes

- The workspace ("Tracewell", an open-source LLM tracing tool), its posts,
  scores and Search Console rows are sample data, labelled on the page.
- Search Console, AI-answer checks and the humanizer are on the roadmap, not
  shipped. They carry a "Preview" label in the sidebar and on their panels. The
  `PREVIEW` set in `app/tour/tour-data.ts` removes the labels once they ship.
- The closing input runs the real `pickForumDomains` logic from
  `lib/communities/forum-packs.ts`.
- The humanizer edits content drafts (articles), not community replies. Hacker
  News and Stack Overflow prohibit AI-written comments; the reply composer stays
  empty for the owner to write.
