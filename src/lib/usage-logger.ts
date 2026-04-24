import { supabase } from "@/lib/supabase";

interface UsageLogParams {
    tenantDomain: string;
    userEmail: string;
    eventType: "generate" | "regenerate" | "stt" | "task_extract" | "terminology" | "profile" | "refine" | "refine_regenerate" | "ask";
    durationMs?: number;
    audioDurationSec?: number;
    model?: string;
    metadata?: Record<string, unknown>;
}

/**
 * 利用状況をusage_logsテーブルに記録する
 * 非同期で実行し、エラーが発生しても本体処理には影響しない
 */
export async function logUsage(params: UsageLogParams): Promise<void> {
    try {
        if (!supabase) return;

        await supabase.from("usage_logs").insert({
            tenant_domain: params.tenantDomain,
            user_email: params.userEmail,
            event_type: params.eventType,
            duration_ms: params.durationMs ?? null,
            audio_duration_sec: params.audioDurationSec ?? null,
            model: params.model ?? null,
            metadata: params.metadata ?? {},
        });
    } catch (error) {
        // コスト計測のエラーで本体処理を止めない
        console.error("⚠️ [UsageLogger] Failed to log usage:", error);
    }
}
