/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@hookscope/shared"],
  experimental: {},
  // Reown AppKit / wagmi connectors statically import several optional wallet
  // SDKs (Porto, Safe Apps, Base Account, etc.) we don't use — externalize
  // instead of installing every one. Must use the object form ("commonjs "
  // prefix) — bare strings with @/-/ characters get emitted by webpack as
  // raw (invalid) JS expressions instead of quoted require() calls.
  webpack: (config) => {
    const externalNames = [
      "pino-pretty",
      "lokijs",
      "encoding",
      "porto/internal",
      "porto",
      "@safe-global/safe-apps-provider",
      "@safe-global/safe-apps-sdk",
      "@walletconnect/ethereum-provider",
      "accounts",
      "@base-org/account",
      "@metamask/connect-evm",
    ];
    config.externals.push(
      Object.fromEntries(externalNames.map((name) => [name, `commonjs ${name}`]))
    );
    return config;
  },
  // Proxy /api/* to the backend API server in production (avoids CORS and exposes no backend URL to client)
  async rewrites() {
    const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
