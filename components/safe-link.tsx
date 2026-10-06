import { safeHttpUrl } from "@/lib/http/safe-url";

/**
 * External link for URLs that came from scraped sources or a model. Renders an anchor only for plain
 * http(s) URLs; anything else shows as text so there is never a link without a safe target.
 */
export function SafeLink({
  href,
  className,
  children,
}: {
  href: string | null | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  const safe = safeHttpUrl(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a href={safe} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
