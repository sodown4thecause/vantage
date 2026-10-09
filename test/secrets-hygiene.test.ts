import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const trackedFiles = () =>
  execSync("git ls-files", { cwd: process.cwd() }).toString().split("\n");

describe("secrets hygiene", () => {
  it("tracks no environment or secret files except the placeholder example", () => {
    const tracked = trackedFiles().filter(
      (file) =>
        /^\.env(\..+)?$/.test(file) ||
        /\.(pem|key|p12|keystore)$/i.test(file),
    );
    expect(tracked).toEqual([".env.example"]);
  });

  it("ignores every real env file, including local backups", () => {
    const ignore = read(".gitignore");
    expect(ignore).toMatch(/^\.env\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });

  it("keeps the committed example free of real credentials", () => {
    const example = read(".env.example");
    const assignments = example
      .split("\n")
      .filter((line) => /^[A-Z0-9_]+=/.test(line));

    expect(assignments.length).toBeGreaterThan(5);

    const placeholderMarkers =
      /xxx|replace-with|REGION|example\.com|localhost|your-|USER|PASSWORD|digest@contextfor\.dev|^Vantage$|^(false|true)$/i;
    const providerKeyShape = /^(sk|re|pk|rk|ghp|github_pat)_[A-Za-z0-9]{16,}$/;
    const opaqueBlob = /^[A-Za-z0-9+/_-]{40,}$/;

    for (const line of assignments) {
      const value = line.slice(line.indexOf("=") + 1).replace(/^["']|["']$/g, "");
      if (!value) continue;
      expect(providerKeyShape.test(value), `key-shaped value: ${line}`).toBe(
        false,
      );
      expect(
        opaqueBlob.test(value) && !placeholderMarkers.test(value),
        `opaque value without placeholder: ${line}`,
      ).toBe(false);
    }
  });
});
