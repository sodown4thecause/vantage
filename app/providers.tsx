"use client";

import { NeonAuthUIProvider } from "@neondatabase/auth-ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { authClient } from "@/lib/auth/client";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      // The night survey theme is dark unconditionally. Without this the
      // provider's next-themes default ("system") puts a `light` class and
      // `color-scheme: light` on <html> for anyone whose OS is light, so
      // native UI (scrollbars, form controls, autofill) renders light against
      // the dark surfaces.
      defaultTheme="dark"
      navigate={(href) => window.location.assign(href)}
      replace={(href) => window.location.replace(href)}
      Link={Link}
      redirectTo="/setup"
    >
      {children}
    </NeonAuthUIProvider>
  );
}
