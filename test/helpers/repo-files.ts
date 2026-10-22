import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Source files a repo-wide "single entry point" scan should read: tracked files
 * plus untracked files that are not git-ignored, as POSIX paths relative to the
 * repo root (the test cwd). Asking git instead of walking the disk skips local
 * tool output (.mikk/, .e2e/, node_modules, build dirs), so the scan stays fast
 * on any machine.
 */
export function repoSourceFiles(skipDirs: readonly string[]): string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed.split("\0").filter(
    (rel) =>
      /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(rel) &&
      !rel.endsWith(".d.ts") &&
      !rel.split("/").some((part) => skipDirs.includes(part)) &&
      existsSync(rel),
  );
}
