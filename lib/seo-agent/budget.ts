import type { PlannedCall } from "@/lib/seo-agent/conversations";

const DEFAULT_AUTO_CREDITS = 3;

/** Credits one question may spend before it asks. Blank, malformed or negative values use the default. */
export function autoCreditsFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SEO_AGENT_AUTO_CREDITS?.trim();
  if (!raw) return DEFAULT_AUTO_CREDITS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_AUTO_CREDITS;
}

/** GEO calls always need approval unless SEO_AGENT_GEO_ALWAYS_ASK is exactly "false". */
export function geoAlwaysAsk(env: Record<string, string | undefined> = process.env): boolean {
  return env.SEO_AGENT_GEO_ALWAYS_ASK !== "false";
}

/** Key order does not matter, so a plan read back from the database still matches the re-run input. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const sameCall = (a: PlannedCall, b: PlannedCall) => a.tool === b.tool && canonicalJson(a.input) === canonicalJson(b.input);

/**
 * Credits one question may spend without asking. It only decides how many uncached calls run before the owner is
 * asked; the monthly credits are charged by the DataForSEO gate per real call.
 *
 * An approved call runs once, even over budget. Its approval is used up when it matches, so a repeated call asks again.
 */
export class QuestionBudget {
  spent = 0;
  planned: PlannedCall[] = [];
  private readonly approved: PlannedCall[];

  constructor(readonly autoCredits: number, approved: PlannedCall[] = []) {
    this.approved = approved.map((call) => ({ ...call }));
  }

  tryReserve(call: PlannedCall, alwaysAsk: boolean): "go" | "ask" {
    const index = this.approved.findIndex((approval) => sameCall(approval, call));
    if (index !== -1) {
      this.approved.splice(index, 1);
      this.spent += call.credits;
      return "go";
    }
    if (!alwaysAsk && this.spent + call.credits <= this.autoCredits) {
      this.spent += call.credits;
      return "go";
    }
    if (!this.planned.some((planned) => sameCall(planned, call))) this.planned.push(call);
    return "ask";
  }

  refund(credits: number): void {
    this.spent = Math.max(0, this.spent - credits);
  }
}
