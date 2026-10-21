import type { Metadata } from "next";

import { TourSurface } from "@/app/tour/tour-surface";
import { absoluteUrl } from "@/lib/site";

const TITLE = "Tour the workspace";
const DESCRIPTION =
  "Explore a guided sample contextfor.dev workspace: a chat-first GTM conversation with illustrative evidence, plus clearly labelled SEO, GEO and Content previews. No live data or model calls.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/tour") },
  openGraph: { title: TITLE, description: DESCRIPTION, url: absoluteUrl("/tour") },
};

export default function TourPage() {
  return <TourSurface />;
}
