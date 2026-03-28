import { NextRequest, NextResponse } from "next/server";
import { knowledgeDb } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";
import { registerTerm } from "@/lib/knowledge-terminology";

export async function POST(request: NextRequest) {
    try {
        if (!knowledgeDb) {
            return NextResponse.json({ error: "DB not configured" }, { status: 500 });
        }

        const { tenant } = await resolveTenantPlan();
        if (!tenant) {
            return NextResponse.json({ error: "テナントが見つかりません" }, { status: 403 });
        }

        const { id, action, category, term, reading, description } = await request.json();

        if (!id || !action) {
            return NextResponse.json({ error: "id と action は必須です" }, { status: 400 });
        }

        if (action === "ignore") {
            const { error } = await knowledgeDb
                .from("terminology_unresolved")
                .update({ status: "ignored", updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        if (action === "register") {
            if (!category || !term) {
                return NextResponse.json({ error: "category と term は必須です" }, { status: 400 });
            }

            // knowledge.terminology に登録
            await registerTerm(
                tenant.tenantId,
                term,
                reading || "",
                description || "",
                category,
                "manual"
            );

            // 未解決ステータスを resolved に更新
            const { error } = await knowledgeDb
                .from("terminology_unresolved")
                .update({
                    status: "resolved",
                    resolved_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", id);
            if (error) throw error;

            console.log(`✅ [Terminology] Registered: ${term} → ${category}`);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "無効なアクションです" }, { status: 400 });
    } catch (error) {
        console.error("❌ [Terminology] Resolve error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "処理エラー" },
            { status: 500 }
        );
    }
}
