import type { NextConfig } from "next";
import withPWAInit from "next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development", // 開発時は無効化
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default withPWA(nextConfig);
