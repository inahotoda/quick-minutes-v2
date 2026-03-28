import { NextRequest, NextResponse } from "next/server";
import { knowledgeDb } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";

export async function GET(request: NextRequest) {
    try {
        if (!knowledgeDb) {
            return NextResponse.json({ error: "DB not configured" }, { status: 500 });
        }

        // テナント解決（tenant_id ベースでフィルタ）
        const { tenant } = await resolveTenantPlan();
        const tenantId = tenant?.tenantId || null;

        const { searchParams } = new URL(request.url);
        const countOnly = searchParams.get("count_only") === "true";

        if (countOnly) {
            let q = knowledgeDb
                .from("terminology_unresolved")
                .select("*", { count: "exact", head: true })
                .eq("status", "pending");
            if (tenantId) q = q.eq("tenant_id", tenantId);
            const { count, error } = await q;

            if (error) throw error;
            return NextResponse.json({ count: count || 0 });
        }

        let q = knowledgeDb
            .from("terminology_unresolved")
            .select("*")
            .eq("status", "pending")
            .order("occurrence_count", { ascending: false })
            .order("last_seen_at", { ascending: false });
        if (tenantId) q = q.eq("tenant_id", tenantId);
        const { data, error } = await q;

        if (error) throw error;
        return NextResponse.json({ items: data || [] });
    } catch (error) {
        console.error("❌ [Terminology] Unresolved fetch error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "取得エラー" },
            { status: 500 }
        );
    }
}
