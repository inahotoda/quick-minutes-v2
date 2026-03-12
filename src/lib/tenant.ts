import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
    isTrialMode,
    extractDomain,
    getTenantByDomain,
    isTenantExpired,
} from "@/lib/supabase";

export interface TenantContext {
    tenantId: string;
    domain: string;
    companyName: string;
    expired: boolean;
    userEmail: string;
    userName: string;
}

/**
 * APIルート用: セッションからテナントを解決する
 * trial モードでない場合は null を返す (Google Drive モード)
 */
export async function resolveTenant(): Promise<{
    tenant: TenantContext | null;
    error?: string;
    statusCode?: number;
}> {
    // 自社版はテナント不要
    if (!isTrialMode()) {
        return { tenant: null };
    }

    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
        return {
            tenant: null,
            error: "認証が必要です",
            statusCode: 401,
        };
    }

    const email = session.user.email;
    const domain = extractDomain(email);

    const tenantData = await getTenantByDomain(domain);
    if (!tenantData) {
        return {
            tenant: null,
            error: "このドメインはモニター対象に登録されていません",
            statusCode: 403,
        };
    }

    const expired = isTenantExpired(tenantData.expires_at);

    return {
        tenant: {
            tenantId: tenantData.tenant_id,
            domain: tenantData.domain,
            companyName: tenantData.company_name,
            expired,
            userEmail: email,
            userName: session.user.name || "不明",
        },
    };
}
