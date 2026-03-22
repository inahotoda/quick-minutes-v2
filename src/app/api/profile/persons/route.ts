import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAIL = process.env.ADMIN_USER_EMAIL || "";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
            return NextResponse.json({ error: "権限がありません" }, { status: 403 });
        }

        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        const { data, error } = await supabase
            .from("meeting_person_analysis")
            .select("person_name")
            .order("person_name");

        if (error) throw error;

        const uniqueNames = [...new Set((data || []).map(d => d.person_name))];
        return NextResponse.json({ persons: uniqueNames });
    } catch (error) {
        console.error("❌ [Profile] Persons fetch error:", error);
        return NextResponse.json({ error: "取得エラー" }, { status: 500 });
    }
}
