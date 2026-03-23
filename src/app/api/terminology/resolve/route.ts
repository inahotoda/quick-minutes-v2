import { NextRequest, NextResponse } from "next/server";
import { supabase, getTenantConfig, saveTenantConfig } from "@/lib/supabase";
import { resolveTenantPlan } from "@/lib/plan";

interface TermEntry {
    term: string;
    reading: string;
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

function parseTerminology(raw: string): TermCategories {
    if (!raw || !raw.trim()) return { companyBrand: [], abbreviation: [], technical: [] };

    const categories: TermCategories = { companyBrand: [], abbreviation: [], technical: [] };
    const hasCategories = /^##\s/m.test(raw);

    if (!hasCategories) {
        const lines = raw.split("\n").filter(l => l.trim());
        for (const line of lines) {
            const cleaned = line.replace(/^[-・]\s*/, "").trim();
            if (!cleaned) continue;
            const readingMatch = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
            const eqMatch = cleaned.match(/^(.+?)\s*=\s*(.+)$/);
            if (readingMatch) {
                categories.technical.push({ term: readingMatch[1].trim(), reading: readingMatch[2].trim() });
            } else if (eqMatch) {
                categories.abbreviation.push({ term: eqMatch[1].trim(), reading: eqMatch[2].trim() });
            } else {
                categories.technical.push({ term: cleaned, reading: "" });
            }
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
        const readingMatch = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
        const eqMatch = cleaned.match(/^(.+?)\s*=\s*(.+)$/);
        if (currentCategory === "abbreviation" && eqMatch) {
            categories.abbreviation.push({ term: eqMatch[1].trim(), reading: eqMatch[2].trim() });
        } else if (readingMatch) {
            categories[currentCategory].push({ term: readingMatch[1].trim(), reading: readingMatch[2].trim() });
        } else {
            categories[currentCategory].push({ term: cleaned, reading: "" });
        }
    }
    return categories;
}

function serializeTerminology(categories: TermCategories): string {
    const sections: string[] = [];
    if (categories.companyBrand.length > 0) {
        const lines = categories.companyBrand.map(e => e.reading ? `- ${e.term}（${e.reading}）` : `- ${e.term}`);
        sections.push(`## 社名・ブランド名\n${lines.join("\n")}`);
    }
    if (categories.abbreviation.length > 0) {
        const lines = categories.abbreviation.map(e => e.reading ? `- ${e.term} = ${e.reading}` : `- ${e.term}`);
        sections.push(`## 略語・社内用語\n${lines.join("\n")}`);
    }
    if (categories.technical.length > 0) {
        const lines = categories.technical.map(e => e.reading ? `- ${e.term}（${e.reading}）` : `- ${e.term}`);
        sections.push(`## 専門用語\n${lines.join("\n")}`);
    }
    return sections.join("\n\n");
}

export async function POST(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
        }

        const { tenant } = await resolveTenantPlan();
        if (!tenant) {
            return NextResponse.json({ error: "テナントが見つかりません" }, { status: 403 });
        }

        const { id, action, category, term, reading } = await request.json();

        if (!id || !action) {
            return NextResponse.json({ error: "id と action は必須です" }, { status: 400 });
        }

        if (action === "ignore") {
            const { error } = await supabase
                .from("terminology_unresolved")
                .update({ status: "ignored", updated_at: new Date().toISOString() })
                .eq("id", id);
            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        if (action === "register") {
            if (!category || !term) {
                return NextResponse.json({ error: "category と term は必須です" }, { status: 400 });
            }

            const categoryKey = CATEGORY_KEY_MAP[category];
            if (!categoryKey) {
                return NextResponse.json({ error: "無効なカテゴリです" }, { status: 400 });
            }

            // 1. Supabaseから既存辞書を読み込み
            const configData = await getTenantConfig(tenant.tenantId, "prompts");
            const config = (configData?.data as any) || { basePrompt: "", internalPrompt: "", businessPrompt: "", otherPrompt: "", terminology: "" };
            const categories = parseTerminology(config.terminology || "");

            // 2. 新しい用語を追加
            categories[categoryKey].push({ term, reading: reading || "" });

            // 3. シリアライズしてSupabaseに保存
            const newTerminology = serializeTerminology(categories);
            const updatedConfig = { ...config, terminology: newTerminology, updatedAt: new Date().toISOString() };
            await saveTenantConfig(tenant.tenantId, "prompts", updatedConfig, tenant.userName);

            // 4. 未解決ステータスを resolved に更新
            const { error } = await supabase
                .from("terminology_unresolved")
                .update({
                    status: "resolved",
                    resolved_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq("id", id);
            if (error) throw error;

            console.log(`✅ [Terminology] Registered: ${term} → ${category}`);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: "無効なアクションです" }, { status: 400 });
    } catch (error) {
        console.error("❌ [Terminology] Resolve error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "処理エラー" },
            { status: 500 }
        );
    }
}
