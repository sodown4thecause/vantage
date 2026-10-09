import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "@/app/providers";
import { appUrl } from "@/lib/app-url";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: "Vantage — social listening for makers",
    template: "%s · Vantage",
  },
  description:
    "Vantage reads Reddit, Hacker News, X, YouTube, Product Hunt and your own feeds, then ranks the conversations worth joining. You write the reply — Vantage never posts for you.",
  openGraph: {
    type: "website",
    siteName: "Vantage",
    url: appUrl(),
    title: "Vantage — social listening for makers",
    description:
      "Find the people already asking for what you build, ranked and delivered daily.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
