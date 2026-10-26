import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" }];
  },
};

export default nextConfig;
