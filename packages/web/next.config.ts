import type { NextConfig } from "next";
import path from "path";

// Read version from monorepo root package.json (single source of truth)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rootPkg = require(path.join(__dirname, "../../package.json")) as {
  version: string;
};

const nextConfig: NextConfig = {
  output: "standalone",
  // Inject app version from root package.json at build time
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPkg.version,
  },
  // Set turbopack root to monorepo root for correct module resolution in Docker builds
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  // Allow E2E tests to use a separate build directory
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Allow cross-origin requests in development (e.g., from reverse proxies)
  allowedDevOrigins: ["localhost", "otter.dev.hexly.ai"],
  // Allow loading images from external domains (e.g., Google avatars)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
