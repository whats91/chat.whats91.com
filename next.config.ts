import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    "whats91.com",
    ".whats91.com",
    "preview.whats91.com",
    "chat.whats91.com",
  ],
  // Transpile socket.io-client for proper bundling in client components
  transpilePackages: ['socket.io-client', 'opus-media-recorder'],
};

export default nextConfig;
