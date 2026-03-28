import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabase = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;

/**
 * サービスロールクライアント（RLSをバイパス、管理者APIのみで使用）
 */
export const supabaseAdmin = supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

/**
 * knowledge スキーマ専用クライアント
 * メンバー・プリセット・用語データの正規化テーブルにアクセス
 */
export const knowledgeDb = supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        db: { schema: "knowledge" },
      })
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
 * tenant_domains テーブルでドメイン/メールを検索し、allowed_tenants を返す
 * 1. まずドメインでマッチ（match_type='domain'）
 * 2. なければ個別メールでマッチ（match_type='email'）
 */
export async function getTenantByDomainOrEmail(domain: string, email: string) {
    if (!supabase) return null;

    // 1. ドメインマッチ（tenant_domains テーブル）
    const { data: domainMatch } = await supabase
        .from("tenant_domains")
        .select("tenant_id")
        .eq("domain", domain)
        .eq("match_type", "domain")
        .limit(1)
        .single();

    if (domainMatch) {
        const { data: tenant } = await supabase
            .from("allowed_tenants")
            .select("*")
            .eq("tenant_id", domainMatch.tenant_id)
            .eq("is_active", true)
            .single();
        if (tenant) return tenant;
    }

    // 2. 個別メールマッチ
    if (email) {
        const { data: emailMatch } = await supabase
            .from("tenant_domains")
            .select("tenant_id")
            .eq("email", email.toLowerCase())
            .eq("match_type", "email")
            .limit(1)
            .single();

        if (emailMatch) {
            const { data: tenant } = await supabase
                .from("allowed_tenants")
                .select("*")
                .eq("tenant_id", emailMatch.tenant_id)
                .eq("is_active", true)
                .single();
            if (tenant) return tenant;
        }
    }

    return null;
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
