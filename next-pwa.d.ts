declare module "@ducanh2912/next-pwa" {
    import { NextConfig } from "next";

    interface PWAConfig {
        dest: string;
        register?: boolean;
        disable?: boolean;
        cacheOnFrontEndNav?: boolean;
        reloadOnOnline?: boolean;
        workboxOptions?: {
            skipWaiting?: boolean;
            clientsClaim?: boolean;
            runtimeCaching?: unknown[];
        };
    }

    export default function withPWA(config: PWAConfig): (nextConfig: NextConfig) => NextConfig;
}
