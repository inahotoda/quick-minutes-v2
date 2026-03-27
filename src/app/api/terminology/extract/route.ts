import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase, getTenantConfig, saveTenantConfig } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";
import { logUsage } from "@/lib/usage-logger";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface ExtractedTerm {
    term: string;
    reading_guess: string | null;
    description_guess: string | null;
    context: string;
    category_guess: "略語・社内用語" | "専門用語" | "社名・ブランド名";
    reason: string;
    confidence: number;
}

interface TermEntry {
    term: string;
    reading: string;
    description: string;
}

interface TermCategories {
    companyBrand: TermEntry[];
    abbreviation: TermEntry[];
    technical: TermEntry[];
}

const CATEGORY_KEY_MAP: Record<string, keyof TermCategories> = {
    "略語・社内用語": "abbreviation",
    "専門用語": "technical",
    "社名・ブランド名": "companyBrand",
};

const AUTO_REGISTER_THRESHOLD = 0.8;

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

function parseTerminology(raw: string): TermCategories {
    if (!raw || !raw.trim()) return { companyBrand: [], abbreviation: [], technical: [] };

    const categories: TermCategories = { companyBrand: [], abbreviation: [], technical: [] };
    const hasCategories = /^##\s/m.test(raw);

    if (!hasCategories) {
        const lines = raw.split("\n").filter(l => l.trim());
        for (const line of lines) {
            const cleaned = line.replace(/^[-・]\s*/, "").trim();
            if (!cleaned) continue;
            const entry = parseSingleTermLine(cleaned);
            categories.technical.push(entry);
        }
        return categories;
    }

    let currentCategory: keyof TermCategories = "technical";
    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (/^##\s/.test(trimmed)) {
            if (/社名|ブランド/i.test(trimmed)) currentCategory = "companyBrand";
            else if (/略語|社内/i.test(trimmed)) currentCategory = "abbreviation";
            else if (/専門/i.test(trimmed)) currentCategory = "technical";
            continue;
        }
        const cleaned = trimmed.replace(/^[-・]\s*/, "").trim();
        if (!cleaned) continue;
        const entry = parseSingleTermLine(cleaned);
        categories[currentCategory].push(entry);
    }
    return categories;
}

/** 1行の用語テキストを TermEntry にパース（新旧フォーマット両対応） */
function parseSingleTermLine(cleaned: string): TermEntry {
    // 新フォーマット: "用語（読み）— 説明" or "用語（読み）- 説明"
    const newFormatMatch = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])\s*[—\-]\s*(.+)$/);
    if (newFormatMatch) {
        return { term: newFormatMatch[1].trim(), reading: newFormatMatch[2].trim(), description: newFormatMatch[3].trim() };
    }

    // 旧フォーマット: "用語（読み）"
    const readingMatch = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
    if (readingMatch) {
        return { term: readingMatch[1].trim(), reading: readingMatch[2].trim(), description: "" };
    }

    // 旧フォーマット: "用語 = 正式名称"
    const eqMatch = cleaned.match(/^(.+?)\s*=\s*(.+)$/);
    if (eqMatch) {
        return { term: eqMatch[1].trim(), reading: "", description: eqMatch[2].trim() };
    }

    return { term: cleaned, reading: "", description: "" };
}

function serializeTerminology(categories: TermCategories): string {
    const sections: string[] = [];

    const formatEntry = (e: TermEntry) => {
        let line = `- ${e.term}`;
        if (e.reading) line += `（${e.reading}）`;
        if (e.description) line += ` — ${e.description}`;
        return line;
    };

    if (categories.companyBrand.length > 0) {
        sections.push(`## 社名・ブランド名\n${categories.companyBrand.map(formatEntry).join("\n")}`);
    }
    if (categories.abbreviation.length > 0) {
        sections.push(`## 略語・社内用語\n${categories.abbreviation.map(formatEntry).join("\n")}`);
    }
    if (categories.technical.length > 0) {
        sections.push(`## 専門用語\n${categories.technical.map(formatEntry).join("\n")}`);
    }
    return sections.join("\n\n");
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
- 広く知られたIT企業・サービス名（Google、Apple、Microsoft、Amazon、Meta、Slack、Zoom、Notion、GitHub、Vercel、AWS、Claude、ChatGPT、Gemini等）
- 広く知られた一般企業・ブランド名（トヨタ、ソニー、マイナビ、リクナビ等、誰でも知っている企業名）
- 一般的なIT用語（DNS、API、URL、SSL、HTML、CSS、PDF等）
- 以下の「登録済み用語リスト」に含まれる用語

【登録済み用語リスト（これらは抽出しないこと）】
${existingTerms || "（なし）"}

【信頼度(confidence)の基準】
各用語に 0.0〜1.0 の信頼度を付与してください：
- 0.8以上: 明らかに社内固有・業界固有で、辞書登録が必須の用語（略語、社内システム名、取引先名等）
- 0.5〜0.8: 辞書登録が有益だが、一般用語との境界が微妙な用語
- 0.5未満: 一般的な用語に近く、登録不要の可能性が高い（出力しないこと）

【出力形式】
以下のJSON配列のみを出力。該当なしなら空配列 [] を返す。

[
  {
    "term": "検出された用語",
    "reading_guess": "読み仮名の推定（カタカナ or ひらがな。不明ならnull）",
    "description_guess": "正式名称や意味の推定（不明ならnull）",
    "context": "用語が出現した前後1〜2文",
    "category_guess": "略語・社内用語 | 専門用語 | 社名・ブランド名",
    "reason": "抽出理由（1文）",
    "confidence": 0.9
  }
]

---
【議事録テキスト】
${minutesText}`;
}

export async function POST(request: NextRequest) {
    const startTime = Date.now();
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

        // 2. Geminiで用語抽出（confidence付き）
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const prompt = buildExtractionPrompt(minutesText, existingTerms);

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // 3. JSONパース
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
            return NextResponse.json({ extracted: 0, autoRegistered: 0, pendingReview: 0, message: "新しい用語は検出されませんでした" });
        }

        // 4. 既存の未解決用語を取得（重複チェック用）
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

        // 5. 信頼度ベースで自動登録 or pending保存
        const highConfidence = extracted.filter(e => (e.confidence ?? 0) >= AUTO_REGISTER_THRESHOLD);
        const lowConfidence = extracted.filter(e => (e.confidence ?? 0) < AUTO_REGISTER_THRESHOLD);

        let autoRegisteredCount = 0;
        let pendingCount = 0;
        let updatedCount = 0;

        // 5a. 高信頼度 → 辞書に自動登録
        if (highConfidence.length > 0 && tenant) {
            const configData = await getTenantConfig(tenant.tenantId, "prompts");
            const config = (configData?.data as any) || { basePrompt: "", internalPrompt: "", businessPrompt: "", otherPrompt: "", terminology: "" };
            const categories = parseTerminology(config.terminology || "");

            for (const item of highConfidence) {
                const existing = existingMap.get(item.term);
                if (existing && existing.status === "resolved") continue;

                const categoryKey = CATEGORY_KEY_MAP[item.category_guess] || "technical";
                // 重複チェック（既に辞書に登録済みか）
                const alreadyRegistered = categories[categoryKey].some(e => e.term === item.term);
                if (alreadyRegistered) continue;

                categories[categoryKey].push({
                    term: item.term,
                    reading: item.reading_guess || "",
                    description: item.description_guess || "",
                });
                autoRegisteredCount++;

                // unresolvedにあればresolvedに更新
                if (existing) {
                    await supabase
                        .from("terminology_unresolved")
                        .update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                        .eq("id", existing.id);
                }
            }

            if (autoRegisteredCount > 0) {
                const newTerminology = serializeTerminology(categories);
                const updatedConfig = { ...config, terminology: newTerminology, updatedAt: new Date().toISOString() };
                await saveTenantConfig(tenant.tenantId, "prompts", updatedConfig, tenant.userName);
                console.log(`✅ [Terminology] Auto-registered ${autoRegisteredCount} high-confidence terms`);
            }
        }

        // 5b. 低信頼度 → terminology_unresolved に保存
        for (const item of lowConfidence) {
            const existing = existingMap.get(item.term);

            if (existing) {
                if (existing.status !== "pending") continue;
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
                await supabase
                    .from("terminology_unresolved")
                    .insert({
                        term: item.term,
                        supplementary: item.reading_guess || item.description_guess,
                        reading_guess: item.reading_guess || null,
                        description_guess: item.description_guess || null,
                        context: item.context,
                        category_guess: item.category_guess,
                        status: "pending",
                        tenant_domain: tenantDomain,
                    });
                pendingCount++;
            }
        }

        console.log(`✅ [Terminology] Extracted ${extracted.length} terms. Auto: ${autoRegisteredCount}, Pending: ${pendingCount}, Updated: ${updatedCount}`);

        // コスト計測
        if (tenant) {
            logUsage({
                tenantDomain: tenant.domain,
                userEmail: tenant.userEmail,
                eventType: "terminology",
                durationMs: Date.now() - startTime,
                model: "gemini-flash-latest",
                metadata: { extracted: extracted.length, autoRegistered: autoRegisteredCount, pending: pendingCount, updated: updatedCount },
            });
        }

        return NextResponse.json({
            extracted: extracted.length,
            autoRegistered: autoRegisteredCount,
            pendingReview: pendingCount,
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
