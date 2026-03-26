import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { extractDomain, getTenantByDomainOrEmail, isTenantExpired } from "@/lib/supabase";

export interface FeatureFlags {
    drive_save: boolean;
    email_send: boolean;
    terminology_pipeline: boolean;
    profile_analysis: boolean;
    task_extraction: boolean;
    task_delivery: boolean;
}

export interface TenantPlan {
    tenantId: string;
    plan: "trial" | "standard" | "premium";
    features: FeatureFlags;
    companyName: string;
    domain: string;
    expired: boolean;
    daysRemaining: number | null;
    userEmail: string;
    userName: string;
}

const PLAN_DEFAULTS: Record<string, FeatureFlags> = {
    trial: { drive_save: false, email_send: false, terminology_pipeline: false, profile_analysis: false, task_extraction: false, task_delivery: false },
    standard: { drive_save: true, email_send: true, terminology_pipeline: true, profile_analysis: false, task_extraction: true, task_delivery: true },
    premium: { drive_save: true, email_send: true, terminology_pipeline: true, profile_analysis: true, task_extraction: true, task_delivery: true },
};

function resolveFeatures(plan: string, overrides: Partial<FeatureFlags>): FeatureFlags {
    const defaults = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.trial;
    return { ...defaults, ...overrides };
}

/**
 * セッションからテナントプランを解決する
 * 全ユーザーがテナントとして解決される（null返却なし）
 */
export async function resolveTenantPlan(): Promise<{
    tenant: TenantPlan | null;
    error?: string;
    statusCode?: number;
}> {
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

    const tenantData = await getTenantByDomainOrEmail(domain, email);
    if (!tenantData) {
        return {
            tenant: null,
            error: "このドメインは登録されていません",
            statusCode: 403,
        };
    }

    const expired = isTenantExpired(tenantData.expires_at);
    const plan = tenantData.plan || "trial";
    const features = resolveFeatures(plan, tenantData.features || {});

    const daysRemaining = tenantData.expires_at
        ? Math.ceil((new Date(tenantData.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;

    return {
        tenant: {
            tenantId: tenantData.tenant_id,
            plan: plan as TenantPlan["plan"],
            features,
            companyName: tenantData.company_name,
            domain: tenantData.domain,
            expired,
            daysRemaining,
            userEmail: email,
            userName: session.user.name || "不明",
        },
    };
}
