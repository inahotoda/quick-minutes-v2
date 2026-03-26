import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";

export async function PATCH(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        const { tenant } = await resolveTenantPlan();
        if (!tenant) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const { taskId, updates } = await request.json();
        if (!taskId) {
            return NextResponse.json({ error: "taskId が必要です" }, { status: 400 });
        }

        // 許可するフィールドのみ通す
        const allowedFields = [
            "assignee", "action_summary", "action_context",
            "deadline_raw", "deadline_date", "priority",
            "recommended_channels", "status", "user_edits",
        ];
        const safeUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
        for (const key of allowedFields) {
            if (updates[key] !== undefined) {
                safeUpdates[key] = updates[key];
            }
        }

        // status が edited の場合、元の値を user_edits に記録
        if (updates.status === "edited" && !safeUpdates.user_edits) {
            safeUpdates.user_edits = updates;
        }

        const { data, error } = await supabase
            .from("tasks")
            .update(safeUpdates)
            .eq("id", taskId)
            .eq("tenant_domain", tenant.domain)
            .select()
            .single();

        if (error) {
            console.error("❌ [Tasks] Update error:", error);
            return NextResponse.json({ error: "タスク更新エラー" }, { status: 500 });
        }

        return NextResponse.json({ task: data });
    } catch (error) {
        console.error("❌ [Tasks] Update error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "タスク更新エラー" },
            { status: 500 }
        );
    }
}
