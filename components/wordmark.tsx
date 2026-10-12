import { Mark } from "@/components/glyph";

/** The contextfor.dev wordmark: the score glyph plus the domain, with the TLD set back in ridge. */
export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-lg font-bold tracking-tight text-ink">
      <Mark />
      <span>
        contextfor<span className="font-semibold text-ridge">.dev</span>
      </span>
    </span>
  );
}
