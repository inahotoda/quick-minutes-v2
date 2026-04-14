import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const ADMIN_EMAIL = process.env.ADMIN_USER_EMAIL || "";

function isAdminUser(email: string): boolean {
    return email === ADMIN_EMAIL;
}

/**
 * GET: テナント一覧取得（ドメイン情報付き）
 */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        if (!isAdminUser(session.user.email || "")) {
            return NextResponse.json({ error: "管理者権限がありません" }, { status: 403 });
        }

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
        }

        // テナント一覧取得
        const { data: tenants, error: tenantError } = await supabaseAdmin
            .from("allowed_tenants")
            .select("*")
            .order("created_at", { ascending: false });

        if (tenantError) throw tenantError;

        // ドメイン一覧取得
        const { data: domains, error: domainError } = await supabaseAdmin
            .from("tenant_domains")
            .select("*")
            .order("created_at", { ascending: true });

        if (domainError) throw domainError;

        // テナントにドメイン情報をマージ
        const tenantsWithDomains = (tenants || []).map((t) => ({
            ...t,
            domains: (domains || []).filter((d) => d.tenant_id === t.tenant_id),
        }));

        return NextResponse.json({ tenants: tenantsWithDomains });
    } catch (error) {
        console.error("Tenant list error:", error);
        return NextResponse.json({ error: "テナント一覧の取得に失敗しました" }, { status: 500 });
    }
}

/**
 * POST: テナント追加 or 既存テナントにドメイン追加
 * Body (新規): { input: "*@domain.com" or "email@gmail.com", companyName: "ABC商事", days: 30 }
 * Body (追加): { tenantId: "abc-corp", input: "*@domain.com" or "email@gmail.com" }
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        if (!isAdminUser(session.user.email || "")) {
            return NextResponse.json({ error: "管理者権限がありません" }, { status: 403 });
        }

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
        }

        const { input, companyName, days = 30, tenantId: existingTenantId } = await request.json();

        if (!input) {
            return NextResponse.json({ error: "アドレス/ドメインは必須です" }, { status: 400 });
        }

        const trimmedInput = input.trim().toLowerCase();
        let matchType: string;
        let domain: string;
        let email: string | null = null;

        if (trimmedInput.startsWith("*@")) {
            matchType = "domain";
            domain = trimmedInput.slice(2);
        } else if (trimmedInput.includes("@")) {
            matchType = "email";
            domain = trimmedInput.split("@")[1];
            email = trimmedInput;
        } else {
            return NextResponse.json({ error: "「*@ドメイン」または「メールアドレス」形式で入力してください" }, { status: 400 });
        }

        // 既存テナントへのドメイン追加
        if (existingTenantId) {
            // 重複チェック
            const { data: existing } = await supabaseAdmin
                .from("tenant_domains")
                .select("id")
                .eq("tenant_id", existingTenantId)
                .eq("domain", domain)
                .eq("match_type", matchType);

            if (matchType === "email" && existing) {
                const dup = existing.find(() => true); // check any
                if (dup) {
                    // さらにemailで重複チェック
                    const { data: emailDup } = await supabaseAdmin
                        .from("tenant_domains")
                        .select("id")
                        .eq("tenant_id", existingTenantId)
                        .eq("email", email);
                    if (emailDup && emailDup.length > 0) {
                        return NextResponse.json({ error: "このアドレスは既に登録されています" }, { status: 409 });
                    }
                }
            } else if (matchType === "domain" && existing && existing.length > 0) {
                return NextResponse.json({ error: "このドメインは既に登録されています" }, { status: 409 });
            }

            const { error } = await supabaseAdmin
                .from("tenant_domains")
                .insert({
                    tenant_id: existingTenantId,
                    domain,
                    email,
                    match_type: matchType,
                });

            if (error) throw error;

            return NextResponse.json({ success: true });
        }

        // 新規テナント作成
        if (!companyName) {
            return NextResponse.json({ error: "企業名は必須です" }, { status: 400 });
        }

        const tenantId = `tenant-${Date.now()}`;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        const { error: tenantError } = await supabaseAdmin
            .from("allowed_tenants")
            .insert({
                tenant_id: tenantId,
                company_name: companyName,
                is_active: true,
                expires_at: expiresAt.toISOString(),
            });

        if (tenantError) {
            if (tenantError.code === "23505") {
                return NextResponse.json({ error: "このテナントは既に登録されています" }, { status: 409 });
            }
            throw tenantError;
        }

        // ドメイン/メール登録
        const { error: domainError } = await supabaseAdmin
            .from("tenant_domains")
            .insert({
                tenant_id: tenantId,
                domain,
                email,
                match_type: matchType,
            });

        if (domainError) throw domainError;

        return NextResponse.json({
            success: true,
            tenant: { tenantId, companyName, expiresAt },
        });
    } catch (error) {
        console.error("Tenant add error:", error);
        return NextResponse.json({ error: "テナント追加に失敗しました" }, { status: 500 });
    }
}

/**
 * PATCH: テナントの有効期限を更新（延長/短縮）
 * Body (延長): { tenantId: "abc-corp", extendDays: 30 } → 現在の期限または今日のどちらか後の日付から延長
 * Body (直接指定): { tenantId: "abc-corp", expiresAt: "2026-12-31T00:00:00.000Z" }
 */
export async function PATCH(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        if (!isAdminUser(session.user.email || "")) {
            return NextResponse.json({ error: "管理者権限がありません" }, { status: 403 });
        }

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
        }

        const { tenantId, extendDays, expiresAt } = await request.json();

        if (!tenantId) {
            return NextResponse.json({ error: "tenantId は必須です" }, { status: 400 });
        }

        let newExpiresAt: Date;

        if (typeof expiresAt === "string") {
            const parsed = new Date(expiresAt);
            if (isNaN(parsed.getTime())) {
                return NextResponse.json({ error: "expiresAt の形式が不正です" }, { status: 400 });
            }
            newExpiresAt = parsed;
        } else if (typeof extendDays === "number" && extendDays > 0) {
            // 現在のテナント情報を取得
            const { data: current, error: fetchError } = await supabaseAdmin
                .from("allowed_tenants")
                .select("expires_at")
                .eq("tenant_id", tenantId)
                .single();

            if (fetchError) throw fetchError;
            if (!current) {
                return NextResponse.json({ error: "テナントが見つかりません" }, { status: 404 });
            }

            // 期限切れなら今日から、有効期間内なら現在の期限から延長
            const currentExpiry = new Date(current.expires_at);
            const now = new Date();
            const base = currentExpiry > now ? currentExpiry : now;
            newExpiresAt = new Date(base);
            newExpiresAt.setDate(newExpiresAt.getDate() + extendDays);
        } else {
            return NextResponse.json({ error: "extendDays (正の数) または expiresAt が必要です" }, { status: 400 });
        }

        const { error: updateError } = await supabaseAdmin
            .from("allowed_tenants")
            .update({
                expires_at: newExpiresAt.toISOString(),
                is_active: true,
            })
            .eq("tenant_id", tenantId);

        if (updateError) throw updateError;

        return NextResponse.json({
            success: true,
            expiresAt: newExpiresAt.toISOString(),
        });
    } catch (error) {
        console.error("Tenant update error:", error);
        return NextResponse.json({ error: "有効期限の更新に失敗しました" }, { status: 500 });
    }
}

/**
 * DELETE: テナント削除 or 個別ドメイン削除
 * Body: { tenantId: "abc-corp" } → テナント全体削除
 * Body: { domainId: "uuid" } → 個別ドメイン削除
 */
export async function DELETE(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        if (!isAdminUser(session.user.email || "")) {
            return NextResponse.json({ error: "管理者権限がありません" }, { status: 403 });
        }

        if (!supabaseAdmin) {
            return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
        }

        const { tenantId, domainId } = await request.json();

        if (domainId) {
            // 個別ドメイン削除
            const { error } = await supabaseAdmin
                .from("tenant_domains")
                .delete()
                .eq("id", domainId);

            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        if (tenantId) {
            // テナント全体削除（CASCADE で tenant_domains も消える）
            const { error } = await supabaseAdmin
                .from("allowed_tenants")
                .delete()
                .eq("tenant_id", tenantId);

            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "tenantId または domainId は必須です" }, { status: 400 });
    } catch (error) {
        console.error("Tenant delete error:", error);
        return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
    }
}
