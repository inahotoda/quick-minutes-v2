import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";
import { logUsage } from "@/lib/usage-logger";
import { randomUUID } from "crypto";
import { ExtractedTask } from "@/types";

/**
 * タスク保存 API（軽量版）
 * クライアント側でパース済みの ExtractedTask[] を受け取り、Supabase に保存するだけ
 * Claude Sonnet は不要
 */
export async function POST(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        const { tenant } = await resolveTenantPlan();
        const tenantDomain = tenant?.domain || null;

        if (tenant && !tenant.features.task_extraction) {
            return NextResponse.json({ tasks: [], message: "この機能はご利用のプランでは無効です" });
        }

        const body = await request.json();
        const tasks: ExtractedTask[] = body.tasks;

        if (!tasks || tasks.length === 0) {
            return NextResponse.json({ tasks: [], batchId: null, summary: { total: 0, by_assignee: {} } });
        }

        const batchId = randomUUID();
        const insertRows = tasks.map((task) => ({
            tenant_domain: tenantDomain,
            extraction_batch: batchId,
            assignee: task.assignee,
            assignee_confidence: task.assignee_confidence,
            action_summary: task.action_summary,
            action_context: task.action_context,
            source_text: task.source_text,
            deadline_raw: task.deadline_raw,
            deadline_date: task.deadline_date,
            deadline_confidence: task.deadline_confidence,
            priority: task.priority,
            recommended_channels: task.recommended_channels.map((ch) =>
                typeof ch === "string" ? ch : ch.type
            ),
            status: task.status || "pending",
        }));

        const { data: insertedTasks, error: insertError } = await supabase
            .from("tasks")
            .insert(insertRows)
            .select("id, assignee, assignee_confidence, action_summary, action_context, source_text, deadline_raw, deadline_date, deadline_confidence, priority, recommended_channels, status");

        if (insertError) {
            console.error("❌ [Tasks/Save] Insert error:", insertError);
            return NextResponse.json({ error: "タスク保存エラー" }, { status: 500 });
        }

        // recommended_channels をオブジェクト形式に戻す
        const responseTasks = (insertedTasks || []).map((row, idx) => ({
            ...row,
            recommended_channels: tasks[idx]?.recommended_channels || [],
        }));

        const byAssignee: Record<string, number> = {};
        tasks.forEach(t => {
            const key = t.assignee || "未定";
            byAssignee[key] = (byAssignee[key] || 0) + 1;
        });

        console.log(`✅ [Tasks/Save] Saved ${tasks.length} tasks (batch: ${batchId})`);

        // コスト計測
        if (tenant) {
            logUsage({
                tenantDomain: tenant.domain,
                userEmail: tenant.userEmail,
                eventType: "task_extract",
                metadata: { taskCount: tasks.length, byAssignee: byAssignee },
            });
        }

        return NextResponse.json({
            tasks: responseTasks,
            batchId,
            summary: { total: tasks.length, by_assignee: byAssignee },
        });
    } catch (error) {
        console.error("❌ [Tasks/Save] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "タスク保存エラー" },
            { status: 500 }
        );
    }
}
