import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";

export async function POST(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        const { tenant } = await resolveTenantPlan();
        if (!tenant) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }
        if (!tenant.features.task_delivery) {
            return NextResponse.json({ error: "この機能はご利用のプランでは無効です" }, { status: 403 });
        }

        const { taskIds, deliveryResults } = await request.json();

        if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
            return NextResponse.json({ error: "taskIds が必要です" }, { status: 400 });
        }

        if (!deliveryResults || !Array.isArray(deliveryResults)) {
            return NextResponse.json({ error: "deliveryResults が必要です" }, { status: 400 });
        }

        // 配信ログを task_deliveries に記録 + tasks のステータスを更新
        const results = [];

        for (const result of deliveryResults) {
            const { taskId, channel, success, eventId, htmlLink, error: deliveryError } = result;

            // 配信ログ挿入
            const { error: insertError } = await supabase
                .from("task_deliveries")
                .insert({
                    task_id: taskId,
                    channel,
                    status: success ? "sent" : "failed",
                    external_id: eventId || null,
                    error_message: deliveryError || null,
                    delivered_by: tenant.userEmail,
                    delivered_at: success ? new Date().toISOString() : null,
                });

            if (insertError) {
                console.error("❌ [Tasks] Delivery log insert error:", insertError);
            }

            // タスクのステータスを更新
            if (success) {
                await supabase
                    .from("tasks")
                    .update({
                        status: "delivered",
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", taskId);
            }

            results.push({ taskId, channel, success, eventId, htmlLink, error: deliveryError });
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        console.log(`✅ [Tasks] Delivered: ${successCount} success, ${failCount} failed`);

        return NextResponse.json({
            results,
            summary: { success: successCount, failed: failCount },
        });
    } catch (error) {
        console.error("❌ [Tasks] Deliver error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "配信エラー" },
            { status: 500 }
        );
    }
}
