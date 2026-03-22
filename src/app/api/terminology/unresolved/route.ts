import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const countOnly = searchParams.get("count_only") === "true";

        if (countOnly) {
            const { count, error } = await supabase
                .from("terminology_unresolved")
                .select("*", { count: "exact", head: true })
                .eq("status", "pending");

            if (error) throw error;
            return NextResponse.json({ count: count || 0 });
        }

        const { data, error } = await supabase
            .from("terminology_unresolved")
            .select("*")
            .eq("status", "pending")
            .order("occurrence_count", { ascending: false })
            .order("last_seen_at", { ascending: false });

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
