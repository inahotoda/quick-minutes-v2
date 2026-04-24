import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";
import { randomUUID } from "crypto";

export const maxDuration = 120;

function getAnthropicClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY is not set");
    }
    return new Anthropic({ apiKey });
}

interface LLMTask {
    index: number;
    raw_sentence: string;
    assignee: {
        name: string | null;
        original_mention: string | null;
        confidence: number;
    };
    action: {
        summary: string;
        context: string;
    };
    deadline: {
        raw_expression: string | null;
        resolved_date: string | null;
        confidence: number;
    };
    priority: "critical" | "high" | "medium" | "low";
    recommended_channels: Array<{
        type: string;
        reason: string;
    }>;
}

interface LLMResponse {
    tasks: LLMTask[];
    summary: {
        total: number;
        by_assignee: Record<string, number>;
    };
}

const EXTRACT_TASKS_TOOL: Anthropic.Messages.Tool = {
    name: "save_extracted_tasks",
    description: "議事録から抽出したアクションアイテム（タスク）を構造化データとして保存する。",
    input_schema: {
        type: "object",
        properties: {
            tasks: {
                type: "array",
                description: "検出されたタスクのリスト",
                items: {
                    type: "object",
                    properties: {
                        index: { type: "integer" },
                        raw_sentence: { type: "string", description: "該当する発言の引用" },
                        assignee: {
                            type: "object",
                            properties: {
                                name: { type: ["string", "null"], description: "参加者リストと照合した担当者名" },
                                original_mention: { type: ["string", "null"], description: "議事録中の表記" },
                                confidence: { type: "number", description: "0.0-1.0" },
                            },
                            required: ["name", "original_mention", "confidence"],
                        },
                        action: {
                            type: "object",
                            properties: {
                                summary: { type: "string", description: "40文字以内のタスク要約" },
                                context: { type: "string", description: "どの議題から生まれたタスクか" },
                            },
                            required: ["summary", "context"],
                        },
                        deadline: {
                            type: "object",
                            properties: {
                                raw_expression: { type: ["string", "null"], description: "元の表現" },
                                resolved_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
                                confidence: { type: "number" },
                            },
                            required: ["raw_expression", "resolved_date", "confidence"],
                        },
                        priority: {
                            type: "string",
                            enum: ["critical", "high", "medium", "low"],
                        },
                        recommended_channels: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    type: { type: "string", enum: ["google_calendar", "google_chat"] },
                                    reason: { type: "string" },
                                },
                                required: ["type", "reason"],
                            },
                        },
                    },
                    required: [
                        "index",
                        "raw_sentence",
                        "assignee",
                        "action",
                        "deadline",
                        "priority",
                        "recommended_channels",
                    ],
                },
            },
            summary: {
                type: "object",
                properties: {
                    total: { type: "integer" },
                    by_assignee: {
                        type: "object",
                        additionalProperties: { type: "integer" },
                    },
                },
                required: ["total", "by_assignee"],
            },
        },
        required: ["tasks", "summary"],
    },
};

const SYSTEM_PROMPT = `あなたは会議の議事録からアクションアイテム（タスク）を検出し、構造化データに変換する専門家です。

# タスクとして検出するもの
- 「〜する」「〜やる」「〜確認する」「〜送る」「〜作る」「〜調べる」「〜まとめる」「〜手配する」など、行動を示す動詞表現
- 期限を伴う約束: 「〜までに」「来週」「次回まで」「月末まで」「なるべく早く」
- 依頼形: 「〜をお願いします」「〜してもらえますか」
- 意思表明: 「〜を検討する」「〜を進める」
- 「宿題」「TODO」「アクション」と明示的に言及されたもの
- 暗黙のタスク: 「〜について確認しておきます」「次回までに見ておく」も全て含める

# 検出しないもの
- 過去に完了したこと（「〜しました」「〜済みです」）
- 一般的な感想・意見（「〜だと思います」）
- 情報共有のみで行動を伴わないもの
- 会議中にその場で完了したこと

# 拾い漏れ防止
- 議事録を最初から最後まで2回スキャンする。1回目は明示的なタスク、2回目は暗黙のタスクを拾う。
- 拾いすぎより拾い漏れの方が問題。迷ったら含める。
- 1発言に複数タスクがあれば必ず分割する。

# 担当者・期限の精度
- 担当者: 参加者リストと照合し、完全一致する名前を使う。確証がなければ confidence を下げる。
- 期限: 会議日を基準に YYYY-MM-DD に変換。「来週金曜」「月末まで」も具体日付にする。不明なら null。
- confidence: 参加者リストに一致する名前があれば 0.8 以上、曖昧なら 0.5 以下。

# 優先度
- critical: 他タスクをブロックする / 外部影響がある / 当日〜翌日期限
- high: 明示的な期限あり（3日以内）/ 上位者からの依頼
- medium: 期限に余裕あり（1〜2週間）/ 通常業務
- low: 期限なし / 検討事項 / 長期課題

# チャネル推奨
- google_calendar: 期限付きタスクには必ず推奨
- google_chat: 社内メンバーへの依頼タスク
- 両方: 期限付き + 他者依頼

# 重複排除
- 同一担当者・同一内容のタスクは1件にまとめる
- 担当者が異なれば別タスクとして出力

必ず save_extracted_tasks ツールを使って構造化データを返してください。`;

function buildUserMessage(
    minutesText: string,
    meetingDate: string,
    participants: string[],
): string {
    const participantsList = participants.length > 0
        ? participants.join("、")
        : "（参加者リスト未指定）";

    return `# 会議メタデータ
- 会議日時: ${meetingDate}
- 参加者リスト: ${participantsList}

# 議事録テキスト
---
${minutesText}
---

上記の議事録から全てのアクションアイテム（タスク）を漏れなく抽出し、save_extracted_tasks ツールで構造化データとして返してください。`;
}

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
        const { minutesText, meetingDate, participants } = body;

        if (!minutesText || minutesText.trim().length < 50) {
            return NextResponse.json({ error: "議事録テキストが短すぎます" }, { status: 400 });
        }

        const dateStr = meetingDate || new Date().toISOString().split("T")[0];
        const participantList: string[] = participants || [];

        const anthropic = getAnthropicClient();

        // Claude Opus 4.7 で tool use 経由で構造化抽出
        const message = await anthropic.messages.create({
            model: "claude-opus-4-7",
            max_tokens: 16000,
            thinking: { type: "adaptive" },
            system: [
                {
                    type: "text",
                    text: SYSTEM_PROMPT,
                    cache_control: { type: "ephemeral" },
                },
            ],
            tools: [EXTRACT_TASKS_TOOL],
            tool_choice: { type: "tool", name: "save_extracted_tasks" },
            messages: [
                {
                    role: "user",
                    content: buildUserMessage(minutesText, dateStr, participantList),
                },
            ],
        });

        // tool_use ブロックから構造化データを取得
        const toolUseBlock = message.content.find(
            (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
        );

        if (!toolUseBlock || toolUseBlock.name !== "save_extracted_tasks") {
            console.warn("⚠️ [Tasks] Expected tool_use not found in response");
            return NextResponse.json({
                tasks: [],
                summary: { total: 0, by_assignee: {} },
                batchId: null,
                message: "タスクが検出されませんでした",
            });
        }

        const parsed = toolUseBlock.input as unknown as LLMResponse;

        if (!parsed.tasks || parsed.tasks.length === 0) {
            return NextResponse.json({
                tasks: [],
                summary: { total: 0, by_assignee: {} },
                batchId: null,
                message: "タスクは検出されませんでした",
            });
        }

        // Supabase に保存
        const batchId = randomUUID();
        const insertRows = parsed.tasks.map((task) => ({
            tenant_domain: tenantDomain,
            extraction_batch: batchId,
            assignee: task.assignee.name,
            assignee_confidence: task.assignee.confidence,
            action_summary: task.action.summary,
            action_context: task.action.context,
            source_text: task.raw_sentence,
            deadline_raw: task.deadline.raw_expression,
            deadline_date: task.deadline.resolved_date,
            deadline_confidence: task.deadline.confidence,
            priority: task.priority,
            recommended_channels: task.recommended_channels.map((ch) => ch.type),
            status: "pending",
        }));

        const { data: insertedTasks, error: insertError } = await supabase
            .from("tasks")
            .insert(insertRows)
            .select(
                "id, assignee, assignee_confidence, action_summary, action_context, source_text, deadline_raw, deadline_date, deadline_confidence, priority, recommended_channels, status",
            );

        if (insertError) {
            console.error("❌ [Tasks] Insert error:", insertError);
            return NextResponse.json({ error: "タスク保存エラー" }, { status: 500 });
        }

        const responseTasks = (insertedTasks || []).map((row, idx) => ({
            ...row,
            recommended_channels: parsed.tasks[idx]?.recommended_channels || [],
        }));

        console.log(`✅ [Tasks] Extracted ${parsed.tasks.length} tasks via Claude Opus 4.7 (batch: ${batchId})`);

        return NextResponse.json({
            tasks: responseTasks,
            batchId,
            summary: parsed.summary,
        });
    } catch (error) {
        console.error("❌ [Tasks] Extract error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "タスク抽出エラー" },
            { status: 500 },
        );
    }
}
