/**
 * Reference phrases for the semantic intent ladder, written in the register of
 * real posts. Each document is embedded and matched to its nearest anchor; the
 * anchor's rung becomes the document's semantic rung (see semantic.ts).
 *
 * Rungs match intent-ladder.ts: 1 awareness · 2 research · 3 comparison ·
 * 4 purchase/recommend.
 */
export const ANCHORS: Array<{ rung: 1 | 2 | 3 | 4; text: string }> = [
  { rung: 1, text: "anyone else using social listening tools for their startup?" },
  { rung: 1, text: "brand monitoring is kind of a black box imo" },
  { rung: 1, text: "HN is great for catching people talking about dev tools" },
  { rung: 1, text: "product hunt launches are where I first heard about this category" },
  { rung: 2, text: "how do I keep track of when people mention my product online?" },
  { rung: 2, text: "best way to monitor reddit for mentions of a brand without enterprise pricing?" },
  { rung: 2, text: "is there a guide for setting up alerts on HN for a new launch?" },
  { rung: 2, text: "trying to figure out how to monitor forums and RSS for our keywords" },
  { rung: 3, text: "anything better than Mention for tracking HN?" },
  { rung: 3, text: "looking for a tool that tracks brand mentions across reddit and hn" },
  { rung: 3, text: "Brand24 vs Mention, which one actually finds the mentions?" },
  { rung: 3, text: "alternative to Google Alerts that catches forum posts? need something better" },
  { rung: 4, text: "what should I use to monitor mentions? happy to pay for something good" },
  { rung: 4, text: "can anyone recommend a social listening tool that's worth the subscription?" },
  { rung: 4, text: "which of the brand monitoring tools people actually use should I buy?" },
  { rung: 4, text: "I'd sign up for whatever reliably catches HN and reddit mentions, suggestions?" },
];
