import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  headers: async () => [
    {
      // HTMLドキュメントのキャッシュを無効化（デプロイ後の即時反映）
      source: "/((?!_next/static|_next/image|favicon.ico|inaho-logo.png).*)",
      headers: [
        {
          key: "Cache-Control",
          value: "no-cache, no-store, must-revalidate",
        },
        {
          key: "Pragma",
          value: "no-cache",
        },
        {
          key: "Expires",
          value: "0",
        },
      ],
    },
  ],
};

export default nextConfig;
