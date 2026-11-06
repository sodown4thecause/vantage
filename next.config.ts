import type { NextConfig } from "next";

import { posthogHost } from "./lib/analytics/config";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      // Well-known documents must live at the origin root. A rewrite keeps them
      // out of a dot-prefixed app directory, which Next does not route.
      beforeFiles: [
        {
          source: "/.well-known/oauth-protected-resource",
          destination: "/api/agent/well-known/oauth-protected-resource",
        },
        {
          source: "/.well-known/oauth-authorization-server",
          destination: "/api/agent/well-known/oauth-authorization-server",
        },
      ],
      afterFiles: [{ source: "/ingest/:path*", destination: `${posthogHost()}/:path*` }],
    };
  },
};

export default nextConfig;
