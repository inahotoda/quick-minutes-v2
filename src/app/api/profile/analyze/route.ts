import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface AnalyzedPerson {
    person_name: string;
    mvv_signals: {
        v1_change: { positive: string[]; negative: string[] };
        v2_team: { positive: string[]; negative: string[] };
        v3_thanks: { positive: string[]; negative: string[] };
    };
    topic_sentiments: Array<{
        topic: string;
        sentiment: "positive" | "negative" | "neutral";
        evidence: string;
    }>;
    utterance_count: number;
    utterance_chars: number;
}

function buildAnalysisPrompt(minutesText: string): string {
    return `あなたは組織行動の分析エキスパートです。
以下の議事録を読み、発言者ごとに3つの観点で分析してください。

【分析観点】

1. MVVシグナル検出
   以下の3つのバリューに対して、ポジティブ・ネガティブそれぞれのシグナル（具体的な発言内容の要約）を検出してください。

   V1「変化を楽しむ」
   - ポジティブ: 新しい提案、変更への前向きな反応、挑戦的な姿勢、失敗を学びとして語る
   - ネガティブ: 現状維持への固執、変更への抵抗、「前はこうだった」型の発言、リスク回避一辺倒

   V2「チームで勝つ」
   - ポジティブ: 他者への建設的フィードバック、部門横断の協力、情報共有、「我々」主語
   - ネガティブ: 他責・責任転嫁、自部門のみの視点、情報の囲い込み

   V3「最後に『ありがとう』をもらう」
   - ポジティブ: 顧客視点の発言、品質・納期へのこだわり、顧客満足を起点にした判断
   - ネガティブ: 顧客不在の議論、コスト削減のみで品質軽視、短期利益優先

2. テーマ別ポジティブ/ネガティブ判定
   発言者がどの議題・テーマに対してポジティブ（積極的・前向き）で、どの議題に対してネガティブ（消極的・抵抗的・沈黙）かを判定してください。

3. 発言量
   各発言者の発言回数と概算文字数を数えてください。

【重要な注意事項】
- シグナルは具体的な発言内容に基づくこと。推測や一般論は不要。
- 該当するシグナルがなければ空配列を返すこと。無理にシグナルを見つけようとしない。
- 発言が極端に少ない人（1〜2回のみ）は、シグナル検出を行わず、発言量のみ記録。

【出力形式】
以下のJSON配列のみを出力。

[
  {
    "person_name": "発言者名",
    "mvv_signals": {
      "v1_change": {
        "positive": ["シグナルの要約（1文）"],
        "negative": ["シグナルの要約（1文）"]
      },
      "v2_team": {
        "positive": [],
        "negative": []
      },
      "v3_thanks": {
        "positive": [],
        "negative": []
      }
    },
    "topic_sentiments": [
      {
        "topic": "議題・テーマ名",
        "sentiment": "positive | negative | neutral",
        "evidence": "判定根拠（1文）"
      }
    ],
    "utterance_count": 数値,
    "utterance_chars": 数値
  }
]

---
【議事録テキスト】
${minutesText}`;
}

export async function POST(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        // features チェック
        const { tenant } = await resolveTenantPlan();
        if (tenant && !tenant.features.profile_analysis) {
            return NextResponse.json({ analyzed: [], message: "この機能はご利用のプランでは無効です" });
        }

        const { minutesText, meetingDate } = await request.json();
        if (!minutesText || minutesText.trim().length < 50) {
            return NextResponse.json({ error: "議事録テキストが短すぎます" }, { status: 400 });
        }

        // Geminiで分析
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const prompt = buildAnalysisPrompt(minutesText);

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // JSONパース
        let analyzed: AnalyzedPerson[] = [];
        try {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                analyzed = JSON.parse(jsonMatch[0]);
            }
        } catch (parseErr) {
            console.error("⚠️ [Profile] Failed to parse LLM response:", parseErr);
            return NextResponse.json({ analyzed: 0, message: "パース失敗" });
        }

        if (analyzed.length === 0) {
            return NextResponse.json({ analyzed: 0, message: "発言者が検出されませんでした" });
        }

        // 全発言者の合計発言回数を算出
        const totalUtterances = analyzed.reduce((sum, p) => sum + p.utterance_count, 0);
        const dateStr = meetingDate || new Date().toISOString().split("T")[0];

        // 発言者ごとにDBへINSERT
        let insertedCount = 0;
        for (const person of analyzed) {
            const { error } = await supabase
                .from("meeting_person_analysis")
                .insert({
                    person_name: person.person_name,
                    mvv_signals: person.mvv_signals,
                    topic_sentiments: person.topic_sentiments,
                    utterance_count: person.utterance_count,
                    utterance_chars: person.utterance_chars,
                    meeting_total_utterances: totalUtterances,
                    meeting_date: dateStr,
                });

            if (!error) insertedCount++;
            else console.error(`⚠️ [Profile] Insert failed for ${person.person_name}:`, error.message);
        }

        console.log(`✅ [Profile] Analyzed ${analyzed.length} persons. Inserted: ${insertedCount}`);

        return NextResponse.json({
            analyzed: analyzed.length,
            inserted: insertedCount,
        });
    } catch (error) {
        console.error("❌ [Profile] Analyze error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "分析エラー" },
            { status: 500 }
        );
    }
}
