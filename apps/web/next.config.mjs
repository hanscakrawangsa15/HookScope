/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@hookscope/shared"],
  experimental: {},
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
