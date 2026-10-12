import Link from "next/link";

import { Shell } from "@/components/shell";

export default function NotFound() {
  return (
    <Shell>
      <div className="space-y-5">
        <h1 className="display text-4xl sm:text-5xl">This page does not exist.</h1>
        <p className="max-w-[48ch] text-lg text-ridge">
          The link may be old or mistyped. Start from the home page or browse the blog.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="btn">Go to the home page</Link>
          <Link href="/blog" className="btn btn-quiet">Read the blog</Link>
        </div>
      </div>
    </Shell>
  );
}
