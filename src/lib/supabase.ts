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
 * ドメインからテナント情報を取得
 */
export async function getTenantByDomain(domain: string) {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from("allowed_tenants")
        .select("*")
        .eq("domain", domain)
        .eq("is_active", true)
        .single();

    if (error || !data) return null;
    return data;
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
