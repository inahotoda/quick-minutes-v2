import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const ADMIN_EMAIL = process.env.ADMIN_USER_EMAIL || "";

function buildProfilePrompt(
    personName: string,
    periodStart: string,
    periodEnd: string,
    meetingsCount: number,
    aggregatedData: string
): string {
    return `あなたはINAHO MFG株式会社の組織分析アドバイザーです。
以下は、社員「${personName}」の ${periodStart} 〜 ${periodEnd} の
会議発言分析データ（${meetingsCount}件の議事録から抽出）です。

このデータを基に、以下の人物プロファイルを生成してください。

【INAHOのバリュー】
V1: 変化を楽しむ
V2: チームで勝つ
V3: 最後に「ありがとう」をもらう

【出力内容】

1. MVV適合度スコア（各 0〜100）
   - データが少ない場合（シグナル5件未満）はスコアを出さず null と記載
   - スコアの根拠となる主要なシグナルを引用
   - 前期比のトレンド（improving / stable / declining）を判定
     ※前期データがない場合は「initial」と記載

2. ポジティブ/ネガティブ傾向
   - ポジティブなテーマ上位3つ（頻度＋具体例）
   - ネガティブなテーマ上位3つ（頻度＋具体例）
   - 配属・タスク割り当てへの推奨コメント

3. 発言量サマリー
   - 1会議あたりの平均発言回数
   - 会議内での発言占有率
   - トレンド（increasing / stable / decreasing）
   - 発言が極端に少ない場合はフラグ

4. 総合プロファイル（3〜5文の自然言語サマリー）

5. 配属・タスク推奨（2〜3文）

【出力形式】
以下のJSONのみを出力。

{
  "mvv_v1_score": 数値 or null,
  "mvv_v2_score": 数値 or null,
  "mvv_v3_score": 数値 or null,
  "mvv_overall": 数値 or null,
  "mvv_detail": {
    "v1_change": {
      "score": 数値 or null,
      "trend": "improving | stable | declining | initial",
      "top_positive": ["...", "..."],
      "top_negative": ["...", "..."],
      "summary": "1〜2文の要約"
    },
    "v2_team": {
      "score": 数値 or null,
      "trend": "...",
      "top_positive": [],
      "top_negative": [],
      "summary": "..."
    },
    "v3_thanks": {
      "score": 数値 or null,
      "trend": "...",
      "top_positive": [],
      "top_negative": [],
      "summary": "..."
    }
  },
  "affinity_profile": {
    "positive_themes": [
      { "theme": "テーマ名", "frequency": 数値, "sample": "具体例" }
    ],
    "negative_themes": [
      { "theme": "テーマ名", "frequency": 数値, "sample": "具体例" }
    ],
    "recommendation": "配属推奨コメント"
  },
  "avg_utterance_count": 数値,
  "avg_utterance_ratio": 数値（0〜1）,
  "utterance_trend": "increasing | stable | decreasing",
  "low_participation_flag": true | false,
  "summary_text": "総合プロファイル（3〜5文）",
  "assignment_recommendation": "配属・タスク推奨（2〜3文）"
}

---
【分析データ】
${aggregatedData}`;
}

export async function POST(request: NextRequest) {
    try {
        // Admin認証
        const session = await getServerSession(authOptions);
        if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) {
            return NextResponse.json({ error: "権限がありません" }, { status: 403 });
        }

        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        const { personName, periodStart, periodEnd } = await request.json();
        if (!personName || !periodStart || !periodEnd) {
            return NextResponse.json({ error: "personName, periodStart, periodEnd は必須です" }, { status: 400 });
        }

        // 対象期間のデータを取得
        const { data: analyses, error: fetchError } = await supabase
            .from("meeting_person_analysis")
            .select("*")
            .eq("person_name", personName)
            .gte("meeting_date", periodStart)
            .lte("meeting_date", periodEnd)
            .order("meeting_date", { ascending: true });

        if (fetchError) throw fetchError;

        if (!analyses || analyses.length === 0) {
            return NextResponse.json({ error: "対象期間にデータがありません" }, { status: 404 });
        }

        // データを集約してプロンプト用テキスト化
        const aggregatedData = JSON.stringify(analyses.map(a => ({
            date: a.meeting_date,
            mvv_signals: a.mvv_signals,
            topic_sentiments: a.topic_sentiments,
            utterance_count: a.utterance_count,
            utterance_chars: a.utterance_chars,
            meeting_total_utterances: a.meeting_total_utterances,
        })), null, 2);

        // LLMでプロファイル生成
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const prompt = buildProfilePrompt(
            personName, periodStart, periodEnd, analyses.length, aggregatedData
        );

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // JSONパース
        let profile: any;
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                profile = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error("JSON not found in response");
            }
        } catch (parseErr) {
            console.error("⚠️ [Profile] Failed to parse profile response:", parseErr);
            return NextResponse.json({ error: "プロファイル生成結果のパースに失敗" }, { status: 500 });
        }

        // DBにUPSERT
        const { error: upsertError } = await supabase
            .from("person_profiles")
            .upsert({
                person_name: personName,
                period_start: periodStart,
                period_end: periodEnd,
                meetings_analyzed: analyses.length,
                mvv_v1_score: profile.mvv_v1_score,
                mvv_v2_score: profile.mvv_v2_score,
                mvv_v3_score: profile.mvv_v3_score,
                mvv_overall: profile.mvv_overall,
                mvv_detail: profile.mvv_detail || {},
                affinity_profile: profile.affinity_profile || {},
                avg_utterance_count: profile.avg_utterance_count,
                avg_utterance_ratio: profile.avg_utterance_ratio,
                utterance_trend: profile.utterance_trend,
                low_participation_flag: profile.low_participation_flag || false,
                summary_text: profile.summary_text,
                assignment_recommendation: profile.assignment_recommendation,
                generated_at: new Date().toISOString(),
            }, { onConflict: "person_name,period_start,period_end" });

        if (upsertError) throw upsertError;

        console.log(`✅ [Profile] Generated profile for ${personName} (${periodStart} ~ ${periodEnd})`);

        return NextResponse.json({ success: true, profile });
    } catch (error) {
        console.error("❌ [Profile] Generate error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "プロファイル生成エラー" },
            { status: 500 }
        );
    }
}
