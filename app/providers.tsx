"use client";

import { NeonAuthUIProvider } from "@neondatabase/auth-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { AnalyticsIdentity } from "@/app/analytics-identity";
import { authClient } from "@/lib/auth/client";

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();

  return (
    <NeonAuthUIProvider
      authClient={authClient}
      // The night survey theme is dark unconditionally. Without this the
      // provider's next-themes default ("system") puts a `light` class and
      // `color-scheme: light` on <html> for anyone whose OS is light, so
      // native UI (scrollbars, form controls, autofill) renders light against
      // the dark surfaces.
      defaultTheme="dark"
      // Neon Auth emails a 6-digit code on email sign-up. Without this the UI
      // never renders a box to enter it, so new email accounts get stuck.
      emailVerification={{ otp: true }}
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => {
        router.refresh();
      }}
      Link={Link}
      redirectTo="/"
    >
      <AnalyticsIdentity />
      {children}
    </NeonAuthUIProvider>
  );
}
