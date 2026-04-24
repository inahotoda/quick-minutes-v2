import { NextRequest, NextResponse } from "next/server";
import { askStream, ASK_MODEL } from "@/lib/ask";
import { resolveTenantPlan } from "@/lib/plan";
import { logUsage } from "@/lib/usage-logger";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();
    const requestStartTime = Date.now();

    try {
        const body = await request.json();
        const { minutesMarkdown, question, history } = body as {
            minutesMarkdown?: string;
            question?: string;
            history?: Array<{ role: "user" | "assistant"; content: string }>;
        };

        if (!minutesMarkdown || minutesMarkdown.trim().length < 20) {
            return NextResponse.json({ error: "議事録が必要です" }, { status: 400 });
        }
        if (!question || question.trim().length === 0) {
            return NextResponse.json({ error: "質問が空です" }, { status: 400 });
        }

        const { tenant } = await resolveTenantPlan();

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    let chunkCount = 0;
                    for await (const chunk of askStream({ minutesMarkdown, question, history })) {
                        chunkCount++;
                        controller.enqueue(encoder.encode(chunk));
                    }

                    if (tenant) {
                        logUsage({
                            tenantDomain: tenant.domain,
                            userEmail: tenant.userEmail,
                            eventType: "ask",
                            durationMs: Date.now() - requestStartTime,
                            model: ASK_MODEL,
                            metadata: {
                                chunkCount,
                                questionLength: question.length,
                                hasHistory: !!history?.length,
                            },
                        });
                    }

                    controller.close();
                } catch (error) {
                    console.error("❌ [Ask] Stream error:", error);
                    controller.error(error);
                }
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-cache",
            },
        });
    } catch (error) {
        console.error("POST /api/ask error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "質問処理エラー" },
            { status: 500 },
        );
    }
}
