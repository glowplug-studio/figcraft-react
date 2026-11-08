import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["paper"],
  agentRules: false,
  devIndicators: false,
};

export default nextConfig;
