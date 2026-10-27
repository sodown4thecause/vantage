import type { NextConfig } from "next";

import { posthogHost } from "./lib/analytics/config";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/ingest/:path*", destination: `${posthogHost()}/:path*` }];
  },
};

export default nextConfig;
