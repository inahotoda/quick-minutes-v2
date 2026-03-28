import { knowledgeDb } from "./supabase";

interface KnowledgeTermRow {
    id: string;
    tenant_id: string;
    term: string;
    reading: string | null;
    definition: string | null;
    category: "abbreviation" | "technical" | "brand" | "internal" | "general";
    source: string;
    is_active: boolean;
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

const CATEGORY_TO_KEY: Record<string, keyof TermCategories> = {
    brand: "companyBrand",
    abbreviation: "abbreviation",
    technical: "technical",
    internal: "abbreviation",
    general: "technical",
};

const KEY_TO_CATEGORY: Record<keyof TermCategories, string> = {
    companyBrand: "brand",
    abbreviation: "abbreviation",
    technical: "technical",
};

const CATEGORY_KEY_MAP: Record<string, keyof TermCategories> = {
    "略語・社内用語": "abbreviation",
    "専門用語": "technical",
    "社名・ブランド名": "companyBrand",
};

/**
 * knowledge.terminology からテナントの用語一覧をマークダウンテキストとして取得
 */
export async function loadTerminologyText(tenantId: string): Promise<string> {
    if (!knowledgeDb) return "";
    const categories = await loadTerminologyCategories(tenantId);
    return serializeTerminology(categories);
}

/**
 * knowledge.terminology からテナントの用語一覧をカテゴリ構造で取得
 */
export async function loadTerminologyCategories(tenantId: string): Promise<TermCategories> {
    const categories: TermCategories = { companyBrand: [], abbreviation: [], technical: [] };
    if (!knowledgeDb) return categories;

    const { data, error } = await knowledgeDb
        .from("terminology")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("term");

    if (error || !data) return categories;

    for (const row of data as KnowledgeTermRow[]) {
        const key = CATEGORY_TO_KEY[row.category] || "technical";
        categories[key].push({
            term: row.term,
            reading: row.reading || "",
            description: row.definition || "",
        });
    }

    return categories;
}

/**
 * TermCategories → マークダウンテキストに変換
 */
export function serializeTerminology(categories: TermCategories): string {
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

/**
 * knowledge.terminology に用語を登録
 */
export async function registerTerm(
    tenantId: string,
    term: string,
    reading: string,
    description: string,
    categoryGuess: string,
    source: string = "auto_extracted"
): Promise<void> {
    if (!knowledgeDb) return;

    const category = (() => {
        const key = CATEGORY_KEY_MAP[categoryGuess];
        if (key) return KEY_TO_CATEGORY[key];
        if (["brand", "abbreviation", "technical", "internal", "general"].includes(categoryGuess)) {
            return categoryGuess;
        }
        return "technical";
    })();

    await knowledgeDb
        .from("terminology")
        .upsert({
            tenant_id: tenantId,
            term,
            reading: reading || null,
            definition: description || null,
            category,
            source,
            is_active: true,
            updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id,term" });
}

/**
 * knowledge.terminology に複数用語を一括登録
 */
export async function registerTermsBatch(
    tenantId: string,
    entries: { term: string; reading: string; description: string; categoryGuess: string }[]
): Promise<number> {
    if (!knowledgeDb || entries.length === 0) return 0;

    let registered = 0;
    for (const entry of entries) {
        const { data: existing } = await knowledgeDb
            .from("terminology")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("term", entry.term)
            .single();

        if (!existing) {
            await registerTerm(
                tenantId,
                entry.term,
                entry.reading,
                entry.description,
                entry.categoryGuess,
                "auto_extracted"
            );
            registered++;
        }
    }
    return registered;
}

/**
 * 用語辞書の書き込み（プロンプト設定画面からの保存用）
 * フロントが送ってきたマークダウンテキストをパースして knowledge.terminology に保存
 */
export async function saveTerminologyFromText(tenantId: string, terminologyText: string): Promise<void> {
    if (!knowledgeDb) return;

    const categories = parseTerminology(terminologyText);

    // 既存のmanual/imported用語を取得
    const { data: existing } = await knowledgeDb
        .from("terminology")
        .select("id, term")
        .eq("tenant_id", tenantId);

    const existingTerms = new Set((existing || []).map((r: any) => r.term));
    const incomingTerms = new Set<string>();

    // カテゴリごとにupsert
    for (const [key, entries] of Object.entries(categories)) {
        const category = KEY_TO_CATEGORY[key as keyof TermCategories] || "technical";
        for (const entry of entries) {
            incomingTerms.add(entry.term);
            await knowledgeDb
                .from("terminology")
                .upsert({
                    tenant_id: tenantId,
                    term: entry.term,
                    reading: entry.reading || null,
                    definition: entry.description || null,
                    category,
                    source: "manual",
                    is_active: true,
                    updated_at: new Date().toISOString(),
                }, { onConflict: "tenant_id,term" });
        }
    }

    // 送信されなかった既存用語は is_active=false に
    const removedTerms = [...existingTerms].filter(t => !incomingTerms.has(t));
    if (removedTerms.length > 0) {
        for (const term of removedTerms) {
            await knowledgeDb
                .from("terminology")
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq("tenant_id", tenantId)
                .eq("term", term);
        }
    }
}

/** マークダウンテキスト → TermCategories にパース */
function parseTerminology(raw: string): TermCategories {
    if (!raw || !raw.trim()) return { companyBrand: [], abbreviation: [], technical: [] };

    const categories: TermCategories = { companyBrand: [], abbreviation: [], technical: [] };
    const hasCategories = /^##\s/m.test(raw);

    if (!hasCategories) {
        const lines = raw.split("\n").filter(l => l.trim());
        for (const line of lines) {
            const cleaned = line.replace(/^[-・]\s*/, "").trim();
            if (!cleaned) continue;
            categories.technical.push(parseSingleTermLine(cleaned));
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
        categories[currentCategory].push(parseSingleTermLine(cleaned));
    }
    return categories;
}

function parseSingleTermLine(cleaned: string): TermEntry {
    const newFormatMatch = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])\s*[—\-]\s*(.+)$/);
    if (newFormatMatch) {
        return { term: newFormatMatch[1].trim(), reading: newFormatMatch[2].trim(), description: newFormatMatch[3].trim() };
    }

    const readingMatch = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
    if (readingMatch) {
        return { term: readingMatch[1].trim(), reading: readingMatch[2].trim(), description: "" };
    }

    const eqMatch = cleaned.match(/^(.+?)\s*=\s*(.+)$/);
    if (eqMatch) {
        return { term: eqMatch[1].trim(), reading: "", description: eqMatch[2].trim() };
    }

    return { term: cleaned, reading: "", description: "" };
}

export { CATEGORY_KEY_MAP, type TermCategories, type TermEntry };
