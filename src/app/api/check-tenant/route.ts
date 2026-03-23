import { NextResponse } from "next/server";
import { resolveTenantPlan } from "@/lib/plan";

/**
 * GET /api/check-tenant
 * テナント情報・プラン・機能フラグを返す（全デプロイ共通）
 */
export async function GET() {
    try {
        const { tenant, error, statusCode } = await resolveTenantPlan();

        if (!tenant) {
            return NextResponse.json({
                allowed: false,
                reason: error || "unknown",
            }, { status: statusCode || 403 });
        }

        if (tenant.expired) {
            return NextResponse.json({
                allowed: false,
                reason: "expired",
                companyName: tenant.companyName,
            });
        }

        return NextResponse.json({
            allowed: true,
            tenantId: tenant.tenantId,
            plan: tenant.plan,
            features: tenant.features,
            companyName: tenant.companyName,
            daysRemaining: tenant.daysRemaining,
        });
    } catch (error: any) {
        console.error("check-tenant error:", error);
        return NextResponse.json(
            { allowed: false, reason: "error", message: error.message },
            { status: 500 }
        );
    }
}
