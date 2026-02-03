declare module "next-pwa" {
    import { NextConfig } from "next";

    interface PWAConfig {
        dest: string;
        register?: boolean;
        skipWaiting?: boolean;
        disable?: boolean;
        scope?: string;
        sw?: string;
        runtimeCaching?: any[];
        buildExcludes?: (string | RegExp)[];
        publicExcludes?: string[];
        fallbacks?: {
            document?: string;
            image?: string;
            font?: string;
            audio?: string;
            video?: string;
        };
    }

    export default function withPWA(config: PWAConfig): (nextConfig: NextConfig) => NextConfig;
}
