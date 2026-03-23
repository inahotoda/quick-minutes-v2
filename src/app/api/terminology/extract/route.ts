import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase, getTenantConfig } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface ExtractedTerm {
    term: string;
    supplementary: string | null;
    context: string;
    category_guess: "略語・社内用語" | "専門用語" | "社名・ブランド名";
    reason: string;
}

async function loadExistingTerminology(tenantId: string): Promise<string> {
    try {
        const config = await getTenantConfig(tenantId, "prompts");
        if (config?.data) {
            const data = config.data as any;
            return data.terminology || "";
        }
        return "";
    } catch {
        return "";
    }
}

function buildExtractionPrompt(minutesText: string, existingTerms: string): string {
    return `あなたは日本語の議事録テキストから、AIが正確に認識・処理できない可能性のある
専門用語・業界用語・略語・固有名詞を検出するアナリストです。

以下の議事録テキストを読み、次の条件に該当する用語をすべて抽出してください。

【抽出対象と分類】
1. 略語・社内用語 — アルファベットの略語で、一般に知られていないもの
2. 専門用語 — 業界固有の用語で、一般的な辞書に載っていないもの
3. 社名・ブランド名 — 取引先やブランドの名前で、読み間違えやすいもの

【除外対象】
- 一般的な日本語の単語
- 広く知られたビジネス用語（KPI、ROI、MTG等）
- 以下の「登録済み用語リスト」に含まれる用語

【登録済み用語リスト（これらは抽出しないこと）】
${existingTerms || "（なし）"}

【出力形式】
以下のJSON配列のみを出力。該当なしなら空配列 [] を返す。

[
  {
    "term": "検出された用語",
    "supplementary": "略語なら正式名称、専門用語なら意味の推定、社名なら読みの推定（不明ならnull）",
    "context": "用語が出現した前後1〜2文",
    "category_guess": "略語・社内用語 | 専門用語 | 社名・ブランド名",
    "reason": "抽出理由（1文）"
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

        // テナント解決
        const { tenant } = await resolveTenantPlan();
        const tenantDomain = tenant?.domain || null;
        const tenantId = tenant?.tenantId || null;

        // features チェック
        if (tenant && !tenant.features.terminology_pipeline) {
            return NextResponse.json({ extracted: [], message: "この機能はご利用のプランでは無効です" });
        }

        const { minutesText } = await request.json();
        if (!minutesText || minutesText.trim().length < 50) {
            return NextResponse.json({ error: "議事録テキストが短すぎます" }, { status: 400 });
        }

        // 1. 既存辞書を取得
        const existingTerms = await loadExistingTerminology(tenantId || "");

        // 2. Geminiで用語抽出
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const prompt = buildExtractionPrompt(minutesText, existingTerms);

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // 3. JSONパース（```json ... ``` で囲まれている場合も対応）
        let extracted: ExtractedTerm[] = [];
        try {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                extracted = JSON.parse(jsonMatch[0]);
            }
        } catch (parseErr) {
            console.error("⚠️ [Terminology] Failed to parse LLM response:", parseErr);
            return NextResponse.json({ extracted: [], message: "パース失敗" });
        }

        if (extracted.length === 0) {
            return NextResponse.json({ extracted: [], message: "新しい用語は検出されませんでした" });
        }

        // 4. 既存の未解決用語を取得（重複チェック用 — テナント単位）
        let query = supabase
            .from("terminology_unresolved")
            .select("id, term, status, occurrence_count")
            .in("term", extracted.map(e => e.term));
        if (tenantDomain) {
            query = query.eq("tenant_domain", tenantDomain);
        } else {
            query = query.is("tenant_domain", null);
        }
        const { data: existingUnresolved } = await query;

        const existingMap = new Map(
            (existingUnresolved || []).map(r => [r.term, r])
        );

        // 5. UPSERT処理
        let insertedCount = 0;
        let updatedCount = 0;

        for (const item of extracted) {
            const existing = existingMap.get(item.term);

            if (existing) {
                // resolved/ignored はスキップ
                if (existing.status !== "pending") continue;

                // pending → カウント加算
                await supabase
                    .from("terminology_unresolved")
                    .update({
                        occurrence_count: existing.occurrence_count + 1,
                        last_seen_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", existing.id);
                updatedCount++;
            } else {
                // 新規INSERT
                await supabase
                    .from("terminology_unresolved")
                    .insert({
                        term: item.term,
                        supplementary: item.supplementary,
                        context: item.context,
                        category_guess: item.category_guess,
                        status: "pending",
                        tenant_domain: tenantDomain,
                    });
                insertedCount++;
            }
        }

        console.log(`✅ [Terminology] Extracted ${extracted.length} terms. Inserted: ${insertedCount}, Updated: ${updatedCount}`);

        return NextResponse.json({
            extracted: extracted.length,
            inserted: insertedCount,
            updated: updatedCount,
        });
    } catch (error) {
        console.error("❌ [Terminology] Extract error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "用語抽出エラー" },
            { status: 500 }
        );
    }
}
