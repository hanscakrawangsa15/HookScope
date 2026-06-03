import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hookscope/shared"],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
