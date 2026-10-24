"use client";

import posthog from "posthog-js";
import { useEffect, useRef } from "react";

import { authClient } from "@/lib/auth/client";

/**
 * Ties the PostHog browser session to the signed-in user by Neon Auth user id (never the email), and starts a fresh
 * anonymous id on sign-out so the next person on the same browser is not merged into the last one.
 */
export function AnalyticsIdentity() {
  const { data } = authClient.useSession();
  const userId = data?.user?.id ? String(data.user.id) : null;
  const identified = useRef<string | null>(null);

  useEffect(() => {
    if (!posthog.__loaded) return;
    if (userId && identified.current !== userId) {
      posthog.identify(userId);
      identified.current = userId;
    } else if (!userId && identified.current) {
      posthog.reset();
      identified.current = null;
    }
  }, [userId]);

  return null;
}
