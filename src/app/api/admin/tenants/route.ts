import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// 管理者ガード: 自社版（非trial）でのみ動作
function isAdminMode(): boolean {
    return process.env.DEPLOYMENT_MODE !== "trial";
}

/**
 * GET: テナント一覧取得
 */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        if (!isAdminMode()) {
            return NextResponse.json({ error: "管理者権限がありません" }, { status: 403 });
        }

        if (!supabase) {
            return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
        }

        const { data, error } = await supabase
            .from("allowed_tenants")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        return NextResponse.json({ tenants: data || [] });
    } catch (error) {
        console.error("Tenant list error:", error);
        return NextResponse.json({ error: "テナント一覧の取得に失敗しました" }, { status: 500 });
    }
}

/**
 * POST: テナント追加
 * Body: { input: "*@domain.com" or "email@gmail.com", companyName: "ABC商事", days: 30 }
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        if (!isAdminMode()) {
            return NextResponse.json({ error: "管理者権限がありません" }, { status: 403 });
        }

        if (!supabase) {
            return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
        }

        const { input, companyName, days = 30 } = await request.json();

        if (!input || !companyName) {
            return NextResponse.json({ error: "入力とテナント名は必須です" }, { status: 400 });
        }

        const trimmedInput = input.trim().toLowerCase();
        let matchType: string;
        let domain: string;
        let email: string | null = null;
        let tenantId: string;

        if (trimmedInput.startsWith("*@")) {
            // ドメインマッチ: *@abc-corp.com
            matchType = "domain";
            domain = trimmedInput.slice(2);
            tenantId = domain.split(".")[0];
        } else if (trimmedInput.includes("@")) {
            // 個別メール: user@gmail.com
            matchType = "email";
            domain = trimmedInput.split("@")[1];
            email = trimmedInput;
            tenantId = `email-${trimmedInput.replace(/[@.]/g, "-")}`;
        } else {
            return NextResponse.json({ error: "「*@ドメイン」または「メールアドレス」形式で入力してください" }, { status: 400 });
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + days);

        const { error } = await supabase
            .from("allowed_tenants")
            .insert({
                tenant_id: tenantId,
                domain,
                company_name: companyName,
                match_type: matchType,
                email,
                is_active: true,
                expires_at: expiresAt.toISOString(),
            });

        if (error) {
            if (error.code === "23505") {
                return NextResponse.json({ error: "このテナントは既に登録されています" }, { status: 409 });
            }
            throw error;
        }

        return NextResponse.json({
            success: true,
            tenant: { tenantId, domain, email, companyName, matchType, expiresAt },
        });
    } catch (error) {
        console.error("Tenant add error:", error);
        return NextResponse.json({ error: "テナント追加に失敗しました" }, { status: 500 });
    }
}

/**
 * DELETE: テナント削除（無効化）
 */
export async function DELETE(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        if (!isAdminMode()) {
            return NextResponse.json({ error: "管理者権限がありません" }, { status: 403 });
        }

        if (!supabase) {
            return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
        }

        const { tenantId } = await request.json();

        if (!tenantId) {
            return NextResponse.json({ error: "tenant_idは必須です" }, { status: 400 });
        }

        const { error } = await supabase
            .from("allowed_tenants")
            .delete()
            .eq("tenant_id", tenantId);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Tenant delete error:", error);
        return NextResponse.json({ error: "テナント削除に失敗しました" }, { status: 500 });
    }
}
