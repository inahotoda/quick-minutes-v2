import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
    isTrialMode,
    extractDomain,
    getTenantByDomainOrEmail,
    isTenantExpired,
} from "@/lib/supabase";

/**
 * GET /api/check-tenant
 * モニター版で使用: ログインユーザーのテナント情報と有効期限を返す
 */
export async function GET() {
    try {
        // 自社版では常にOK
        if (!isTrialMode()) {
            return NextResponse.json({
                isTrial: false,
                allowed: true,
            });
        }

        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({
                isTrial: true,
                allowed: false,
                reason: "not_authenticated",
            });
        }

        const email = session.user.email;
        const domain = extractDomain(email);
        const tenant = await getTenantByDomainOrEmail(domain, email);

        if (!tenant) {
            return NextResponse.json({
                isTrial: true,
                allowed: false,
                reason: "domain_not_registered",
                domain,
            });
        }

        if (isTenantExpired(tenant.expires_at)) {
            return NextResponse.json({
                isTrial: true,
                allowed: false,
                reason: "trial_expired",
                companyName: tenant.company_name,
                expiredAt: tenant.expires_at,
            });
        }

        return NextResponse.json({
            isTrial: true,
            allowed: true,
            tenantId: tenant.tenant_id,
            companyName: tenant.company_name,
            expiresAt: tenant.expires_at,
            daysRemaining: Math.ceil(
                (new Date(tenant.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            ),
        });
    } catch (error: any) {
        console.error("check-tenant error:", error);
        return NextResponse.json(
            { isTrial: true, allowed: false, reason: "error", message: error.message },
            { status: 500 }
        );
    }
}
