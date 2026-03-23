import { NextRequest, NextResponse } from "next/server";
import { supabase, extractDomain } from "@/lib/supabase";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        // セッションからテナントドメインを取得
        const session = await getServerSession(authOptions);
        const tenantDomain = session?.user?.email
            ? extractDomain(session.user.email)
            : null;

        const { searchParams } = new URL(request.url);
        const countOnly = searchParams.get("count_only") === "true";

        // テナント単位でフィルタリング
        const addTenantFilter = (q: any) => {
            if (tenantDomain) return q.eq("tenant_domain", tenantDomain);
            return q.is("tenant_domain", null);
        };

        if (countOnly) {
            let q = supabase
                .from("terminology_unresolved")
                .select("*", { count: "exact", head: true })
                .eq("status", "pending");
            q = addTenantFilter(q);
            const { count, error } = await q;

            if (error) throw error;
            return NextResponse.json({ count: count || 0 });
        }

        let q = supabase
            .from("terminology_unresolved")
            .select("*")
            .eq("status", "pending")
            .order("occurrence_count", { ascending: false })
            .order("last_seen_at", { ascending: false });
        q = addTenantFilter(q);
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
