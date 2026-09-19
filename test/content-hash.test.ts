import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { contentHash } from "../lib/collectors/hash";

describe("contentHash", () => {
  it("hashes the canonical platform, URL, and content recipe", () => {
    const expected = createHash("sha256")
      .update("hn\nhttps://news.ycombinator.com/item?id=1\nhello")
      .digest("hex");

    expect(
      contentHash(
        "hn",
        "https://news.ycombinator.com/item?id=1",
        "hello",
      ),
    ).toBe(expected);
  });
});
