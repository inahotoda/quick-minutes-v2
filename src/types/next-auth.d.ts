import NextAuth, { DefaultSession } from "next-auth";
import { JWT } from "next-auth/jwt";

declare module "next-auth" {
    interface Session {
        accessToken?: string;
        refreshToken?: string;
        error?: string;
        user: {
            id?: string;
        } & DefaultSession["user"];
    }

    interface Account {
        access_token?: string;
        refresh_token?: string;
        expires_at?: number;
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        accessToken?: string;
        refreshToken?: string;
        accessTokenExpires?: number;
        user?: any;
        error?: string;
    }
}
