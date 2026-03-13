import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

export function isTrialMode(): boolean {
    return process.env.DEPLOYMENT_MODE === "trial";
}

/**
 * メールアドレスからドメインを抽出
 */
export function extractDomain(email: string): string {
    return email.split("@")[1]?.toLowerCase() || "";
}

/**
 * ドメインまたは個別メールアドレスからテナント情報を取得
 * 1. まずドメインでマッチ（match_type='domain'）
 * 2. なければ個別メールでマッチ（match_type='email'）
 */
export async function getTenantByDomainOrEmail(domain: string, email: string) {
    if (!supabase) return null;

    // 1. ドメインマッチ
    const { data: domainMatch } = await supabase
        .from("allowed_tenants")
        .select("*")
        .eq("domain", domain)
        .eq("is_active", true)
        .in("match_type", ["domain"])
        .single();

    if (domainMatch) return domainMatch;

    // 2. 個別メールマッチ
    const { data: emailMatch } = await supabase
        .from("allowed_tenants")
        .select("*")
        .eq("email", email.toLowerCase())
        .eq("is_active", true)
        .eq("match_type", "email")
        .single();

    if (emailMatch) return emailMatch;

    // 3. フォールバック: 旧データ（match_type未設定）のドメインマッチ
    const { data: legacyMatch } = await supabase
        .from("allowed_tenants")
        .select("*")
        .eq("domain", domain)
        .eq("is_active", true)
        .single();

    return legacyMatch || null;
}

/**
 * 旧互換用エクスポート
 */
export async function getTenantByDomain(domain: string) {
    return getTenantByDomainOrEmail(domain, "");
}


/**
 * テナントの有効期限をチェック
 */
export function isTenantExpired(expiresAt: string): boolean {
    return new Date(expiresAt) < new Date();
}

/**
 * テナントの設定を取得
 */
export async function getTenantConfig(tenantId: string, configType: string) {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from("tenant_configs")
        .select("data, updated_by, updated_at")
        .eq("tenant_id", tenantId)
        .eq("config_type", configType)
        .single();

    if (error || !data) return null;
    return data;
}

/**
 * テナントの設定を保存（upsert）
 */
export async function saveTenantConfig(
    tenantId: string,
    configType: string,
    configData: any,
    updatedBy?: string
) {
    if (!supabase) throw new Error("Supabase not configured");

    const { error } = await supabase
        .from("tenant_configs")
        .upsert(
            {
                tenant_id: tenantId,
                config_type: configType,
                data: configData,
                updated_by: updatedBy || "unknown",
                updated_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id,config_type" }
        );

    if (error) throw error;
}
