import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow E2E tests to use a separate build directory
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Allow cross-origin requests in development (e.g., from reverse proxies)
  allowedDevOrigins: ["localhost"],
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
