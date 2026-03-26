import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";

export async function GET(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        const { tenant } = await resolveTenantPlan();
        if (!tenant) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }
        if (!tenant.features.task_extraction) {
            return NextResponse.json({ tasks: [], message: "この機能はご利用のプランでは無効です" });
        }

        const { searchParams } = new URL(request.url);
        const meetingId = searchParams.get("meetingId");
        const batchId = searchParams.get("batchId");

        if (!meetingId && !batchId) {
            return NextResponse.json({ error: "meetingId または batchId が必要です" }, { status: 400 });
        }

        let query = supabase
            .from("tasks")
            .select("*")
            .eq("tenant_domain", tenant.tenantId)
            .order("created_at", { ascending: true });

        if (meetingId) {
            query = query.eq("meeting_id", meetingId);
        }
        if (batchId) {
            query = query.eq("extraction_batch", batchId);
        }

        const { data: tasks, error } = await query;

        if (error) {
            console.error("❌ [Tasks] List error:", error);
            return NextResponse.json({ error: "タスク取得に失敗しました" }, { status: 500 });
        }

        // 配信履歴も取得
        if (tasks && tasks.length > 0) {
            const taskIds = tasks.map(t => t.id);
            const { data: deliveries } = await supabase
                .from("task_deliveries")
                .select("*")
                .in("task_id", taskIds)
                .order("created_at", { ascending: false });

            // タスクに配信履歴を紐付け
            const deliveryMap = new Map<string, any[]>();
            deliveries?.forEach(d => {
                const list = deliveryMap.get(d.task_id) || [];
                list.push(d);
                deliveryMap.set(d.task_id, list);
            });

            const tasksWithDeliveries = tasks.map(t => ({
                ...t,
                deliveries: deliveryMap.get(t.id) || [],
            }));

            return NextResponse.json({ tasks: tasksWithDeliveries });
        }

        return NextResponse.json({ tasks: tasks || [] });
    } catch (error) {
        console.error("❌ [Tasks] List error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "タスク取得エラー" },
            { status: 500 }
        );
    }
}
