import { describe, expect, it } from "vitest";

import { formatSummary, parseCsv, parseRescueCsv, summarize } from "../scripts/gtm/summarize";

const HEADER = "id,source_tool,found_via,contacted_on,rescued_on,activated,paying,founder_minutes,provider_cost_usd,notes";

describe("parseCsv", () => {
  it("handles quoted commas, escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\r\n')).toEqual([
      ["a", "b,c", 'd "q"'],
      ["1", "2", "3"],
    ]);
  });
  it("ignores blank lines", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("summarize", () => {
  it("is empty and failing for a header-only sheet", () => {
    const status = summarize(parseRescueCsv(`${HEADER}\n`));
    expect(status).toMatchObject({ rescues: 0, activations: 0, paying: 0, passed: false, costPerRescueUsd: null });
  });

  it("counts only rescued people toward activation and payment gates", () => {
    const csv = [
      HEADER,
      "a,gummysearch,r/x,2026-11-02,2026-11-03,yes,yes,30,0.2,ok",
      "b,f5bot,r/y,2026-11-03,2026-11-04,yes,no,45,0.1,",
      "c,reddit_rss,r/z,2026-11-04,2026-11-05,no,yes,20,0.3,",
      "d,other,r/w,2026-11-05,,yes,yes,10,0,not rescued",
    ].join("\n");
    const status = summarize(parseRescueCsv(csv));
    expect(status.rescues).toBe(3);
    expect(status.activations).toBe(2);
    expect(status.paying).toBe(2);
    expect(status.passed).toBe(true);
    expect(status.founderMinutes).toBe(105);
    expect(status.providerCostUsd).toBe(0.6);
    expect(status.founderMinutesPerRescue).toBe(35);
    expect(status.costPerRescueUsd).toBe(0.2);
  });

  it("fails the gates when targets are not met", () => {
    const csv = [HEADER, "a,gummysearch,r/x,2026-11-02,2026-11-03,yes,no,30,0.2,"].join("\n");
    const status = summarize(parseRescueCsv(csv));
    expect(status.gates).toEqual({ rescues: false, activations: false, paying: false });
    expect(formatSummary(status)).toContain("Gates not all met");
  });

  it("rejects a rescued_on that is not a date, so 'no' or 'pending' cannot count as a rescue", () => {
    for (const bad of ["no", "n/a", "-", "pending", "11/03/2026"]) {
      const csv = [HEADER, `a,x,y,2026-11-01,${bad},yes,yes,10,0,`].join("\n");
      expect(() => parseRescueCsv(csv)).toThrow(/rescued_on must be YYYY-MM-DD/);
    }
  });

  it("rejects empty and duplicate ids", () => {
    const csv = [HEADER, "a,x,y,,2026-11-02,yes,no,1,0,", "A,x,y,,2026-11-03,yes,no,1,0,", ",x,y,,,no,no,0,0,"].join("\n");
    expect(() => parseRescueCsv(csv)).toThrow(/duplicate id[\s\S]*id is empty/);
  });

  it("rejects unrecognised yes/no and number values instead of guessing", () => {
    const csv = [HEADER, "a,x,y,,2026-11-02,Yes.,x,30 min,-5,"].join("\n");
    expect(() => parseRescueCsv(csv)).toThrow(/activated must be yes or no[\s\S]*paying must be yes or no[\s\S]*founder_minutes[\s\S]*provider_cost_usd/);
  });

  it("accepts the documented yes/no spellings and blank optional cells", () => {
    const csv = [HEADER, "a,x,y,,2026-11-02,Y,TRUE,,,", "b,x,y,,,no,,,,"].join("\n");
    const rows = parseRescueCsv(csv);
    expect(rows[0]).toMatchObject({ activated: true, paying: true, founderMinutes: 0, providerCostUsd: 0 });
    expect(rows[1]).toMatchObject({ activated: false, paying: false, rescuedOn: "" });
  });

  it("requires id, rescued_on, activated and paying columns", () => {
    expect(() => parseRescueCsv("id,rescued_on\na,2026-11-01")).toThrow(/activated, paying/);
    expect(() => parseRescueCsv("name,date\nx,y")).toThrow(/missing required column/);
  });
});
