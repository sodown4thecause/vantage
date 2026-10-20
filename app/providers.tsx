"use client";

import { NeonAuthUIProvider } from "@neondatabase/auth-ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { authClient } from "@/lib/auth/client";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NeonAuthUIProvider
      authClient={authClient}
      navigate={(href) => window.location.assign(href)}
      replace={(href) => window.location.replace(href)}
      Link={Link}
      redirectTo="/setup"
    >
      {children}
    </NeonAuthUIProvider>
  );
}
