"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort boundary for errors thrown while rendering the root layout. Reports to Sentry. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en-AU">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem", maxWidth: "36rem", margin: "0 auto" }}>
        <h1>Something went wrong</h1>
        <p>We&rsquo;ve been notified and will look into it. Please try again.</p>
        <button type="button" onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
