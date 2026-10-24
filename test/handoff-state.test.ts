import { describe, expect, it } from "vitest";

import { handoffState, recapLine } from "@/lib/retention/handoff-state";

describe("handoff state", () => {
  it("reports the furthest step the owner reached", () => {
    expect(handoffState([])).toBeNull();
    expect(handoffState(["useful", "saved"])).toBeNull();
    expect(handoffState(["open"])).toBe("opened");
    expect(handoffState(["open", "copy"])).toBe("copied");
    expect(handoffState(["copy", "sent", "open"])).toBe("sent");
    expect(handoffState(["sent", "replied", "copy"])).toBe("replied");
  });

  it("writes the monthly recap as one plain sentence", () => {
    expect(recapLine({ copied: 0, sent: 0, replied: 0 })).toBeNull();
    expect(recapLine({ copied: 1, sent: 0, replied: 0 })).toBe("This month you've copied 1 reply.");
    expect(recapLine({ copied: 12, sent: 7, replied: 0 })).toBe("This month you've copied 12 replies and marked 7 sent.");
    expect(recapLine({ copied: 12, sent: 7, replied: 2 })).toBe("This month you've copied 12 replies, marked 7 sent and had 2 replies back.");
    expect(recapLine({ copied: 0, sent: 0, replied: 1 })).toBe("This month you've had 1 reply back.");
  });
});
