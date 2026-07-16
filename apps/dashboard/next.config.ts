import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@nexus/database",
  ],
};

export default nextConfig;
