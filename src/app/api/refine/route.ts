import { NextRequest, NextResponse } from "next/server";
import { refineStream, REFINE_MODEL } from "@/lib/refine";
import { MeetingMode } from "@/types";
import { resolveTenantPlan } from "@/lib/plan";
import { getTenantConfig } from "@/lib/supabase";
import { loadTerminologyText } from "@/lib/knowledge-terminology";
import { logUsage } from "@/lib/usage-logger";

// Vercel Pro: max 300s. Claude Opus 4.7 with adaptive thinking + 32k max_tokens needs room.
export const maxDuration = 300;

async function loadTerminology(): Promise<string | undefined> {
    try {
        const { tenant } = await resolveTenantPlan();
        if (!tenant?.tenantId) return undefined;
        const terminology = await loadTerminologyText(tenant.tenantId);
        return terminology || undefined;
    } catch {
        return undefined;
    }
}

async function loadUserFeedbackPrompt(): Promise<string | undefined> {
    // 将来的にテナント別の追加推敲指示を持たせる余地を残す。
    // 現状は terminology と同じ tenant_configs から取れる場合に拾う。
    try {
        const { tenant } = await resolveTenantPlan();
        if (!tenant?.tenantId) return undefined;
        const config = await getTenantConfig(tenant.tenantId, "prompts");
        const promptData = (config?.data as Record<string, string>) || {};
        return promptData.refineHint || undefined;
    } catch {
        return undefined;
    }
}

export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();
    const requestStartTime = Date.now();

    try {
        const body = await request.json();
        const {
            mode,
            draftMarkdown,
            participants,
            notes,
            feedback,
            date,
        } = body as {
            mode?: MeetingMode;
            draftMarkdown?: string;
            participants?: string[];
            notes?: string;
            feedback?: string;
            date?: string;
        };

        if (!draftMarkdown || draftMarkdown.trim().length < 50) {
            return NextResponse.json(
                { error: "推敲対象の下書きが短すぎます" },
                { status: 400 },
            );
        }
        if (!mode) {
            return NextResponse.json({ error: "mode が必要です" }, { status: 400 });
        }

        const { tenant } = await resolveTenantPlan();

        // Feature flag check: claude_refinement が無効なテナントは Phase 2 をスキップ
        if (tenant && !tenant.features.claude_refinement) {
            return NextResponse.json(
                { error: "この機能はご利用のプランでは無効です", code: "FEATURE_DISABLED" },
                { status: 403 },
            );
        }

        const terminology = await loadTerminology();
        const refineHint = await loadUserFeedbackPrompt();

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    let tokenUsage: {
                        input_tokens: number;
                        output_tokens: number;
                        cache_creation_input_tokens?: number;
                        cache_read_input_tokens?: number;
                    } | null = null;

                    const gen = refineStream({
                        mode,
                        draftMarkdown,
                        participants,
                        terminology,
                        notes,
                        feedback: feedback || refineHint,
                        date,
                        onUsage: (u) => { tokenUsage = u; },
                    });

                    let chunkCount = 0;
                    for await (const chunk of gen) {
                        if (chunkCount === 0) {
                            console.log("✨ [Refine] First chunk received from Claude");
                        }
                        chunkCount++;
                        controller.enqueue(encoder.encode(chunk));
                    }
                    console.log(`✨ [Refine] Done. chunks=${chunkCount}`, tokenUsage ? `tokens=${JSON.stringify(tokenUsage)}` : "");

                    if (tenant) {
                        logUsage({
                            tenantDomain: tenant.domain,
                            userEmail: tenant.userEmail,
                            eventType: feedback ? "refine_regenerate" : "refine",
                            durationMs: Date.now() - requestStartTime,
                            model: REFINE_MODEL,
                            metadata: {
                                mode,
                                chunkCount,
                                participantsCount: participants?.length ?? 0,
                                draftLength: draftMarkdown.length,
                                tokenUsage,
                            },
                        });
                    }

                    controller.close();
                } catch (error) {
                    console.error("❌ [Refine] Stream error:", error);
                    controller.error(error);
                }
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-cache",
                "X-Model-Version": encodeURIComponent(REFINE_MODEL),
            },
        });
    } catch (error) {
        console.error("POST /api/refine error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "推敲処理エラー" },
            { status: 500 },
        );
    }
}
