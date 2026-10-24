"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

import { authClient } from "@/lib/auth/client";

/** Ties PostHog events to the signed-in user's id (never the email or name). Renders nothing. */
export function AnalyticsIdentity() {
  const { data } = authClient.useSession();
  const userId = data?.user?.id;

  useEffect(() => {
    if (!posthog.__loaded) return;
    if (userId) posthog.identify(userId);
    else if (posthog.get_distinct_id() && posthog._isIdentified()) posthog.reset();
  }, [userId]);

  return null;
}
