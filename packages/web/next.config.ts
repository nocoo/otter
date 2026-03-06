import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
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
