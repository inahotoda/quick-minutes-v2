import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAIL = process.env.ADMIN_USER_EMAIL || "";

export async function GET(request: NextRequest) {
    try {
        // Admin認証
        const session = await getServerSession(authOptions);
        if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
            return NextResponse.json({ error: "権限がありません" }, { status: 403 });
        }

        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        const { searchParams } = new URL(request.url);
        const personName = searchParams.get("person_name");
        const periodStart = searchParams.get("period_start");
        const periodEnd = searchParams.get("period_end");

        // 特定の人物のプロファイル取得
        if (personName) {
            let query = supabase
                .from("person_profiles")
                .select("*")
                .eq("person_name", personName)
                .order("generated_at", { ascending: false })
                .limit(1);

            if (periodStart && periodEnd) {
                query = query.eq("period_start", periodStart).eq("period_end", periodEnd);
            }

            const { data, error } = await query;
            if (error) throw error;
            return NextResponse.json({ profile: data?.[0] || null });
        }

        // 全員の最新プロファイル一覧
        // person_nameごとに最新のgenerated_atのレコードを取得
        const { data, error } = await supabase
            .from("person_profiles")
            .select("*")
            .order("generated_at", { ascending: false });

        if (error) throw error;

        // person_nameごとに最新のもののみ残す
        const latestByPerson = new Map<string, any>();
        for (const profile of (data || [])) {
            if (!latestByPerson.has(profile.person_name)) {
                latestByPerson.set(profile.person_name, profile);
            }
        }

        return NextResponse.json({ profiles: Array.from(latestByPerson.values()) });
    } catch (error) {
        console.error("❌ [Profile] Fetch error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "取得エラー" },
            { status: 500 }
        );
    }
}
