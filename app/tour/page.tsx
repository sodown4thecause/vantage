import type { Metadata } from "next";

import { TourSurface } from "@/app/tour/tour-surface";
import { absoluteUrl } from "@/lib/site";

const TITLE = "Tour the workspace";
const DESCRIPTION =
  "Run a morning in a demo contextfor.dev workspace: Reddit, X, Hacker News and forum threads ranked for buying intent, Search Console and AI-answer gaps, and a draft edited until it sounds like you.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/tour") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl("/tour") },
};

export default function TourPage() {
  return <TourSurface />;
}
