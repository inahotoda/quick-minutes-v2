import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";
import { randomUUID } from "crypto";

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

function buildExtractionPrompt(
    minutesText: string,
    meetingDate: string,
    participants: string[]
): string {
    const participantsList = participants.length > 0
        ? participants.join("、")
        : "（参加者リスト未指定）";

    return `あなたは会議の議事録からアクションアイテム（タスク）を検出し、
構造化データに変換する専門家です。

## 指示
以下の議事録テキストを読み、参加者が今後実行すべきタスクを
検出・構造化してください。

## タスクの判定基準
以下のいずれかに該当する発言をタスクとして検出してください：
- 誰かが何かを「する」「やる」「確認する」「送る」「作る」「調べる」と明言した
- 「〜までに」「来週」「次回まで」など期限を伴う約束
- 「〜をお願いします」「〜してもらえますか」という依頼
- 「〜を検討する」「〜を進める」という意思表明
- 「宿題」「TODO」「アクション」と明示的に言及されたもの

## タスクとして検出しないもの
- 過去に完了したこと（「〜しました」「〜済みです」）
- 一般的な感想・意見（「〜だと思います」）
- 情報共有のみで行動を伴わないもの
- 会議中にその場で完了したこと

## 会議メタデータ
- 会議日時: ${meetingDate}
- 参加者リスト: ${participantsList}

## 出力フォーマット（JSON）
{
  "tasks": [
    {
      "index": 1,
      "raw_sentence": "<該当する発言をそのまま引用>",
      "assignee": {
        "name": "<参加者リストと照合した担当者名>",
        "original_mention": "<議事録中の表記>",
        "confidence": <0.0-1.0>
      },
      "action": {
        "summary": "<40文字以内のタスク要約>",
        "context": "<どの議題から生まれたタスクか>"
      },
      "deadline": {
        "raw_expression": "<元の表現。なければnull>",
        "resolved_date": "<YYYY-MM-DD形式。会議日時から算出。不明ならnull>",
        "confidence": <0.0-1.0>
      },
      "priority": "<critical/high/medium/low>",
      "recommended_channels": [
        {
          "type": "<google_calendar/google_chat>",
          "reason": "<推奨理由（日本語）>"
        }
      ]
    }
  ],
  "summary": {
    "total": <タスク総数>,
    "by_assignee": {"<名前>": <件数>}
  }
}

## 優先度の判定基準
- critical: 他タスクがブロックされる / 外部への影響
- high: 明示的な期限あり / 上位者からの依頼
- medium: 期限に余裕あり / 通常業務
- low: 期限なし / 検討事項

## チャネル推奨の基準
- google_calendar: 期限付きタスクにはほぼ必ず推奨
- google_chat: 社内メンバーへの依頼タスク
- 両方: 期限付き + 他者依頼

## 注意事項
- 1発言に複数タスクがあれば分割
- 担当者名は参加者リストの名前と照合
- 期限は会議日時を基準に具体日を算出
- タスクなしの場合は tasks: [], summary.total: 0
- confidence: 参加者リストに一致する名前があれば0.8以上、曖昧なら0.5以下
- **重複禁止**: 同一のアクション内容・同一担当者のタスクは1つにまとめること。議事録中に同じ内容が複数回言及されていても、タスクとしては1件のみ出力する
- 類似タスクの統合: 担当者が異なる場合のみ別タスクとして出力する

## 議事録テキスト
---
${minutesText}
---`;
}

export async function POST(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        // テナント解決
        const { tenant } = await resolveTenantPlan();
        const tenantDomain = tenant?.domain || null;

        // features チェック
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

        // Claude Sonnet でタスク抽出
        const prompt = buildExtractionPrompt(minutesText, dateStr, participantList);
        const anthropic = getAnthropicClient();

        const message = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
        });

        // レスポンスからテキストを取得
        const responseText = message.content
            .filter((block): block is Anthropic.TextBlock => block.type === "text")
            .map((block) => block.text)
            .join("");

        // JSONパース
        let parsed: LLMResponse;
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return NextResponse.json({ tasks: [], summary: { total: 0, by_assignee: {} }, batchId: null });
            }
            parsed = JSON.parse(jsonMatch[0]);
        } catch (parseErr) {
            console.error("⚠️ [Tasks] Failed to parse LLM response:", parseErr);
            return NextResponse.json({ tasks: [], summary: { total: 0, by_assignee: {} }, batchId: null, message: "パース失敗" });
        }

        if (!parsed.tasks || parsed.tasks.length === 0) {
            return NextResponse.json({ tasks: [], summary: { total: 0, by_assignee: {} }, batchId: null, message: "タスクは検出されませんでした" });
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
            .select("id, assignee, assignee_confidence, action_summary, action_context, source_text, deadline_raw, deadline_date, deadline_confidence, priority, recommended_channels, status");

        if (insertError) {
            console.error("❌ [Tasks] Insert error:", insertError);
            return NextResponse.json({ error: "タスク保存エラー" }, { status: 500 });
        }

        // recommended_channels をオブジェクト形式に戻してレスポンス
        const responseTasks = (insertedTasks || []).map((row, idx) => ({
            ...row,
            recommended_channels: parsed.tasks[idx]?.recommended_channels || [],
        }));

        console.log(`✅ [Tasks] Extracted ${parsed.tasks.length} tasks (batch: ${batchId})`);

        return NextResponse.json({
            tasks: responseTasks,
            batchId,
            summary: parsed.summary,
        });
    } catch (error) {
        console.error("❌ [Tasks] Extract error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "タスク抽出エラー" },
            { status: 500 }
        );
    }
}
