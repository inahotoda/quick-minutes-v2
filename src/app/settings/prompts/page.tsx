"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "../settings.module.css";

interface PromptConfig {
    basePrompt: string;
    internalPrompt: string;
    businessPrompt: string;
    otherPrompt: string;
    terminology: string;
    updatedBy?: string;
    updatedAt?: string;
    history?: any[];
}

// --- 用語辞書データ構造 ---
interface TermEntry {
    term: string;
    reading: string; // 読み仮名 or 正式名称
}

interface TermCategories {
    companyBrand: TermEntry[];   // 社名・ブランド名
    abbreviation: TermEntry[];   // 略語・社内用語
    technical: TermEntry[];      // 専門用語
}

const EMPTY_CATEGORIES: TermCategories = {
    companyBrand: [],
    abbreviation: [],
    technical: [],
};

// --- パース: terminology文字列 → 構造化データ ---
function parseTerminology(raw: string): TermCategories {
    if (!raw || !raw.trim()) return { ...EMPTY_CATEGORIES };

    const categories: TermCategories = {
        companyBrand: [],
        abbreviation: [],
        technical: [],
    };

    // 新フォーマット: "## カテゴリ名" で区切られている場合
    const hasCategories = /^##\s/m.test(raw);

    if (!hasCategories) {
        // 旧フォーマット: すべて「専門用語」カテゴリにフォールバック
        const lines = raw.split("\n").filter(l => l.trim());
        for (const line of lines) {
            const cleaned = line.replace(/^[-・]\s*/, "").trim();
            if (!cleaned) continue;

            // "用語（読み仮名）" or "用語(読み仮名)" パターン
            const readingMatch = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
            // "略語 = 正式名称" パターン
            const eqMatch = cleaned.match(/^(.+?)\s*=\s*(.+)$/);
            // カンマ区切りの場合
            if (cleaned.includes(",") || cleaned.includes("、")) {
                const items = cleaned.split(/[,、]\s*/);
                for (const item of items) {
                    const im = item.trim().match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
                    if (im) {
                        categories.technical.push({ term: im[1].trim(), reading: im[2].trim() });
                    } else if (item.trim()) {
                        categories.technical.push({ term: item.trim(), reading: "" });
                    }
                }
            } else if (readingMatch) {
                categories.technical.push({ term: readingMatch[1].trim(), reading: readingMatch[2].trim() });
            } else if (eqMatch) {
                categories.abbreviation.push({ term: eqMatch[1].trim(), reading: eqMatch[2].trim() });
            } else {
                categories.technical.push({ term: cleaned, reading: "" });
            }
        }
        return categories;
    }

    // 新フォーマット: セクション別にパース
    let currentCategory: keyof TermCategories = "technical";
    const lines = raw.split("\n");

    for (const line of lines) {
        const trimmed = line.trim();

        // セクション見出し判定
        if (/^##\s/.test(trimmed)) {
            if (/社名|ブランド/i.test(trimmed)) {
                currentCategory = "companyBrand";
            } else if (/略語|社内/i.test(trimmed)) {
                currentCategory = "abbreviation";
            } else if (/専門/i.test(trimmed)) {
                currentCategory = "technical";
            }
            continue;
        }

        const cleaned = trimmed.replace(/^[-・]\s*/, "").trim();
        if (!cleaned) continue;

        // "用語（読み仮名）" パターン
        const readingMatch = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
        // "略語 = 正式名称" パターン
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

// --- シリアライズ: 構造化データ → terminology文字列 ---
function serializeTerminology(categories: TermCategories): string {
    const sections: string[] = [];

    if (categories.companyBrand.length > 0) {
        const lines = categories.companyBrand.map(e =>
            e.reading ? `- ${e.term}（${e.reading}）` : `- ${e.term}`
        );
        sections.push(`## 社名・ブランド名\n${lines.join("\n")}`);
    }

    if (categories.abbreviation.length > 0) {
        const lines = categories.abbreviation.map(e =>
            e.reading ? `- ${e.term} = ${e.reading}` : `- ${e.term}`
        );
        sections.push(`## 略語・社内用語\n${lines.join("\n")}`);
    }

    if (categories.technical.length > 0) {
        const lines = categories.technical.map(e =>
            e.reading ? `- ${e.term}（${e.reading}）` : `- ${e.term}`
        );
        sections.push(`## 専門用語\n${lines.join("\n")}`);
    }

    return sections.join("\n\n");
}

// --- カテゴリ設定 ---
const CATEGORY_CONFIG = {
    companyBrand: {
        icon: "🏢",
        title: "社名・ブランド名",
        subtitle: "取引先やブランド名など、読み間違えやすい固有名詞",
        col1: "用語",
        col2: "読み仮名（任意）",
        placeholder1: "例: YANUK",
        placeholder2: "例: やぬーく",
        borderColor: "#6366f1",
    },
    abbreviation: {
        icon: "🔤",
        title: "略語・社内用語",
        subtitle: "アルファベット略語とその正式名称",
        col1: "略語",
        col2: "正式名称（任意）",
        placeholder1: "例: AMS",
        placeholder2: "例: 生産管理システム",
        borderColor: "#10b981",
    },
    technical: {
        icon: "🔧",
        title: "専門用語",
        subtitle: "業界特有の専門用語（一般辞書にないもの）",
        col1: "用語",
        col2: "読み仮名（任意）",
        placeholder1: "例: 反内縫製",
        placeholder2: "例: たんない",
        borderColor: "#f59e0b",
    },
} as const;

// 未解決用語の型
interface UnresolvedTerm {
    id: string;
    term: string;
    supplementary: string | null;
    context: string;
    category_guess: string;
    occurrence_count: number;
    first_seen_at: string;
    last_seen_at: string;
    status: string;
}

// カテゴリ名 → キーのマッピング
const CATEGORY_GUESS_TO_KEY: Record<string, keyof TermCategories> = {
    "略語・社内用語": "abbreviation",
    "専門用語": "technical",
    "社名・ブランド名": "companyBrand",
};

// カテゴリごとのフィールドラベル
const CATEGORY_FIELD_LABELS: Record<string, { col1: string; col2: string; placeholder2: string }> = {
    "略語・社内用語": { col1: "略語", col2: "正式名称", placeholder2: "例: 生産管理システム" },
    "専門用語": { col1: "用語", col2: "意味・説明", placeholder2: "例: 縫い目の種類のひとつ" },
    "社名・ブランド名": { col1: "社名", col2: "読み", placeholder2: "例: せいたひふく" },
};

export default function PromptsSettingsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    const [settings, setSettings] = useState<PromptConfig>({
        basePrompt: "",
        internalPrompt: "",
        businessPrompt: "",
        otherPrompt: "",
        terminology: "",
    });

    // 用語辞書の構造化データ
    const [termCategories, setTermCategories] = useState<TermCategories>({ ...EMPTY_CATEGORIES });

    // 各カテゴリの入力中の値
    const [inputs, setInputs] = useState<Record<keyof TermCategories, { term: string; reading: string }>>({
        companyBrand: { term: "", reading: "" },
        abbreviation: { term: "", reading: "" },
        technical: { term: "", reading: "" },
    });

    // 未解決用語
    const [unresolvedTerms, setUnresolvedTerms] = useState<UnresolvedTerm[]>([]);
    const [hiddenTermIds, setHiddenTermIds] = useState<Set<string>>(new Set());
    const [resolvingId, setResolvingId] = useState<string | null>(null);

    // 登録モーダル
    const [registerModal, setRegisterModal] = useState<{
        item: UnresolvedTerm;
        category: string;
        term: string;
        reading: string;
    } | null>(null);

    useEffect(() => {
        async function fetchPrompts() {
            try {
                const res = await fetch("/api/prompts");
                if (res.ok) {
                    const data = await res.json();
                    setSettings(data);
                    setTermCategories(parseTerminology(data.terminology || ""));
                }
            } catch (err) {
                console.error("Failed to fetch prompts:", err);
            } finally {
                setLoading(false);
            }
        }
        fetchPrompts();
    }, []);

    // 未解決用語を取得
    useEffect(() => {
        fetch("/api/terminology/unresolved")
            .then(res => res.json())
            .then(data => { if (data.items) setUnresolvedTerms(data.items); })
            .catch(() => {});
    }, []);

    // 用語を追加
    const addTerm = useCallback((category: keyof TermCategories) => {
        const input = inputs[category];
        if (!input.term.trim()) return;

        setTermCategories(prev => ({
            ...prev,
            [category]: [...prev[category], { term: input.term.trim(), reading: input.reading.trim() }],
        }));
        setInputs(prev => ({
            ...prev,
            [category]: { term: "", reading: "" },
        }));
    }, [inputs]);

    // 用語を削除
    const removeTerm = useCallback((category: keyof TermCategories, index: number) => {
        setTermCategories(prev => ({
            ...prev,
            [category]: prev[category].filter((_, i) => i !== index),
        }));
    }, []);

    // 未解決用語: 無視する
    const handleIgnore = async (id: string) => {
        setResolvingId(id);
        try {
            const res = await fetch("/api/terminology/resolve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, action: "ignore" }),
            });
            if (res.ok) {
                setUnresolvedTerms(prev => prev.filter(t => t.id !== id));
            }
        } catch {}
        setResolvingId(null);
    };

    // 未解決用語: 全て登録（AIの推定カテゴリ・読みでまとめて登録）
    const handleRegisterAll = async () => {
        const items = unresolvedTerms.filter(t => !hiddenTermIds.has(t.id));
        if (items.length === 0) return;
        setResolvingId("all");
        try {
            for (const item of items) {
                await fetch("/api/terminology/resolve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: item.id,
                        action: "register",
                        category: item.category_guess,
                        term: item.term,
                        reading: item.supplementary || "",
                    }),
                });
            }
            setUnresolvedTerms([]);
        } catch {}
        setResolvingId(null);
    };

    // 未解決用語: 登録モーダルを開く
    const openRegisterModal = (item: UnresolvedTerm) => {
        setRegisterModal({
            item,
            category: item.category_guess,
            term: item.term,
            reading: item.supplementary || "",
        });
    };

    // 未解決用語: 登録実行
    const handleRegister = async () => {
        if (!registerModal) return;
        setResolvingId(registerModal.item.id);
        try {
            const res = await fetch("/api/terminology/resolve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: registerModal.item.id,
                    action: "register",
                    category: registerModal.category,
                    term: registerModal.term,
                    reading: registerModal.reading,
                }),
            });
            if (res.ok) {
                setUnresolvedTerms(prev => prev.filter(t => t.id !== registerModal.item.id));
                // ローカルの辞書データも更新
                const catKey = CATEGORY_GUESS_TO_KEY[registerModal.category];
                if (catKey) {
                    setTermCategories(prev => ({
                        ...prev,
                        [catKey]: [...prev[catKey], { term: registerModal.term, reading: registerModal.reading }],
                    }));
                }
                setRegisterModal(null);
            }
        } catch {}
        setResolvingId(null);
    };

    // 保存（terminology文字列にシリアライズしてから保存）
    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const terminologyStr = serializeTerminology(termCategories);
            const dataToSave = {
                basePrompt: settings.basePrompt,
                internalPrompt: settings.internalPrompt,
                businessPrompt: settings.businessPrompt,
                otherPrompt: settings.otherPrompt,
                terminology: terminologyStr,
            };

            const res = await fetch("/api/prompts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(dataToSave),
            });
            if (res.ok) {
                const newData = await res.json();
                setSettings(newData.config);
                setTermCategories(parseTerminology(newData.config.terminology || ""));
                setMessage({ type: "success", text: "設定を保存しました" });
                window.scrollTo({ top: 0, behavior: "smooth" });
                setTimeout(() => setMessage(null), 3000);
            } else {
                throw new Error("Save failed");
            }
        } catch (err) {
            setMessage({ type: "error", text: "保存に失敗しました" });
        } finally {
            setSaving(false);
        }
    };

    const handleRestore = (oldVersion: any) => {
        if (confirm("このバージョンの内容を表示しますか？（現在の編集内容は上書きされます）")) {
            setSettings({
                ...settings,
                basePrompt: oldVersion.basePrompt,
                internalPrompt: oldVersion.internalPrompt,
                businessPrompt: oldVersion.businessPrompt,
                otherPrompt: oldVersion.otherPrompt,
                terminology: oldVersion.terminology,
            });
            setTermCategories(parseTerminology(oldVersion.terminology || ""));
            window.scrollTo({ top: 0, behavior: "smooth" });
            setMessage({ type: "success", text: "履歴から復元しました（「保存」するまで確定されません）" });
        }
    };

    // Enterキーで追加
    const handleKeyDown = (e: React.KeyboardEvent, category: keyof TermCategories) => {
        if (e.key === "Enter") {
            e.preventDefault();
            addTerm(category);
        }
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>読み込み中...</p>
            </div>
        );
    }

    const totalTerms = termCategories.companyBrand.length + termCategories.abbreviation.length + termCategories.technical.length;

    return (
        <div className={styles.main}>
            <header className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push("/settings")}>
                    ← 設定に戻る
                </button>
                <h1 className={styles.title}>📝 カスタムプロンプト設定</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.content}>
                {message && (
                    <div className={`${styles.alert} ${styles[message.type]}`}>
                        {message.type === "success" ? "✅" : "⚠️"} {message.text}
                    </div>
                )}

                {settings.updatedBy && (
                    <div className={styles.lastUpdate}>
                        最終更新: {new Date(settings.updatedAt!).toLocaleString("ja-JP")} ({settings.updatedBy})
                    </div>
                )}

                <section className={styles.section}>
                    <h2>基本プロンプト</h2>
                    <p className={styles.help}>議事録の全体的な構成やトーンを指定します。</p>
                    <textarea
                        value={settings.basePrompt}
                        onChange={(e) => setSettings({ ...settings, basePrompt: e.target.value })}
                        placeholder="あなたは優秀な議事録作成アシスタントです。..."
                        rows={8}
                    />
                </section>

                <section className={styles.section}>
                    <h2>社内MTGモード</h2>
                    <p className={styles.help}>「社内」モード選択時に追加される指示です。</p>
                    <textarea
                        value={settings.internalPrompt}
                        onChange={(e) => setSettings({ ...settings, internalPrompt: e.target.value })}
                        placeholder="決定事項とアクションアイテムを優先的に抽出してください。..."
                        rows={5}
                    />
                </section>

                <section className={styles.section}>
                    <h2>商談モード</h2>
                    <p className={styles.help}>「商談」モード選択時に追加される指示です。</p>
                    <textarea
                        value={settings.businessPrompt}
                        onChange={(e) => setSettings({ ...settings, businessPrompt: e.target.value })}
                        placeholder="顧客の課題、提案への反応、ネクストアクションを整理してください。..."
                        rows={5}
                    />
                </section>

                {/* ===== 未解決の用語 ===== */}
                {unresolvedTerms.filter(t => !hiddenTermIds.has(t.id)).length > 0 && (
                    <section className={styles.section}>
                        <div className={styles.unresolvedHeader}>
                            <h2>🔍 未解決の用語</h2>
                            <span className={styles.unresolvedCount}>
                                {unresolvedTerms.filter(t => !hiddenTermIds.has(t.id)).length}件
                            </span>
                        </div>
                        <p className={styles.help}>
                            AIが議事録から検出した未登録の専門用語です。辞書に登録すると次回以降の精度が向上します。
                        </p>

                        <button
                            className={styles.unresolvedRegisterAllBtn}
                            onClick={handleRegisterAll}
                            disabled={resolvingId === "all"}
                        >
                            {resolvingId === "all" ? "登録中..." : "全て登録"}
                        </button>

                        <div className={styles.unresolvedList}>
                            {unresolvedTerms
                                .filter(t => !hiddenTermIds.has(t.id))
                                .map(item => (
                                    <div key={item.id} className={styles.unresolvedItem}>
                                        <div className={styles.unresolvedItemMain}>
                                            <div className={styles.unresolvedTermRow}>
                                                <span className={styles.unresolvedTerm}>{item.term}</span>
                                                <span className={styles.unresolvedCategory}>{item.category_guess}</span>
                                                {item.occurrence_count > 1 && (
                                                    <span className={styles.unresolvedOccurrence}>
                                                        {item.occurrence_count}回出現
                                                    </span>
                                                )}
                                            </div>
                                            {item.supplementary && (
                                                <p className={styles.unresolvedSupplementary}>
                                                    AI推定: {item.supplementary}
                                                </p>
                                            )}
                                            <p className={styles.unresolvedContext}>
                                                {item.context}
                                            </p>
                                        </div>
                                        <div className={styles.unresolvedActions}>
                                            <button
                                                className={styles.unresolvedRegisterBtn}
                                                onClick={() => openRegisterModal(item)}
                                                disabled={resolvingId === item.id}
                                            >
                                                登録する
                                            </button>
                                            <button
                                                className={styles.unresolvedIgnoreBtn}
                                                onClick={() => handleIgnore(item.id)}
                                                disabled={resolvingId === item.id}
                                            >
                                                不要
                                            </button>
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </section>
                )}

                {/* ===== 登録モーダル ===== */}
                {registerModal && (
                    <div className={styles.modalOverlay} onClick={() => setRegisterModal(null)}>
                        <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                            <h3 className={styles.modalTitle}>用語を登録</h3>

                            <div className={styles.modalField}>
                                <label className={styles.modalLabel}>カテゴリ</label>
                                <div className={styles.modalRadioGroup}>
                                    {["専門用語", "略語・社内用語", "社名・ブランド名"].map(cat => (
                                        <label key={cat} className={styles.modalRadio}>
                                            <input
                                                type="radio"
                                                name="category"
                                                checked={registerModal.category === cat}
                                                onChange={() => setRegisterModal({ ...registerModal, category: cat })}
                                            />
                                            <span>{cat}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className={styles.modalField}>
                                <label className={styles.modalLabel}>
                                    {CATEGORY_FIELD_LABELS[registerModal.category]?.col1 || "用語"}
                                </label>
                                <input
                                    className={styles.modalInput}
                                    type="text"
                                    value={registerModal.term}
                                    onChange={e => setRegisterModal({ ...registerModal, term: e.target.value })}
                                />
                            </div>

                            <div className={styles.modalField}>
                                <label className={styles.modalLabel}>
                                    {CATEGORY_FIELD_LABELS[registerModal.category]?.col2 || "補足"}
                                </label>
                                <input
                                    className={styles.modalInput}
                                    type="text"
                                    value={registerModal.reading}
                                    onChange={e => setRegisterModal({ ...registerModal, reading: e.target.value })}
                                    placeholder={CATEGORY_FIELD_LABELS[registerModal.category]?.placeholder2}
                                />
                            </div>

                            <div className={styles.modalActions}>
                                <button
                                    className={styles.modalCancelBtn}
                                    onClick={() => setRegisterModal(null)}
                                >
                                    キャンセル
                                </button>
                                <button
                                    className={styles.modalRegisterBtn}
                                    onClick={handleRegister}
                                    disabled={!registerModal.term.trim() || resolvingId === registerModal.item.id}
                                >
                                    {resolvingId === registerModal.item.id ? "登録中..." : "登録する"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ===== 用語辞書 ===== */}
                <section className={styles.section}>
                    <h2>📖 用語辞書</h2>
                    <p className={styles.help}>
                        音声で正しく認識されにくい固有名詞や専門用語を登録すると、議事録の精度が向上します。
                    </p>

                    <div className={styles.dictInfo}>
                        💡 参加者名は「メンバー管理」から自動で反映されるため、ここへの登録は不要です。
                    </div>

                    {(Object.keys(CATEGORY_CONFIG) as (keyof TermCategories)[]).map((catKey) => {
                        const config = CATEGORY_CONFIG[catKey];
                        const entries = termCategories[catKey];
                        const input = inputs[catKey];

                        return (
                            <div
                                key={catKey}
                                className={styles.dictCategory}
                                style={{ borderLeftColor: config.borderColor }}
                            >
                                <div className={styles.dictCategoryHeader}>
                                    <div>
                                        <h3 className={styles.dictCategoryTitle}>
                                            {config.icon} {config.title}
                                        </h3>
                                        <p className={styles.dictCategorySubtitle}>{config.subtitle}</p>
                                    </div>
                                    <span className={styles.dictBadge} style={{ background: config.borderColor }}>
                                        {entries.length}件
                                    </span>
                                </div>

                                {entries.length > 0 && (
                                    <div className={styles.dictList}>
                                        <div className={styles.dictListHeader}>
                                            <span>{config.col1}</span>
                                            <span>{config.col2}</span>
                                            <span></span>
                                        </div>
                                        {entries.map((entry, idx) => (
                                            <div key={idx} className={styles.dictItem}>
                                                <span className={styles.dictTerm}>{entry.term}</span>
                                                <span className={styles.dictReading}>{entry.reading || "—"}</span>
                                                <button
                                                    className={styles.dictDeleteBtn}
                                                    onClick={() => removeTerm(catKey, idx)}
                                                    title="削除"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className={styles.dictAddRow}>
                                    <input
                                        className={styles.dictInput}
                                        type="text"
                                        placeholder={config.placeholder1}
                                        value={input.term}
                                        onChange={(e) => setInputs(prev => ({
                                            ...prev,
                                            [catKey]: { ...prev[catKey], term: e.target.value },
                                        }))}
                                        onKeyDown={(e) => handleKeyDown(e, catKey)}
                                    />
                                    <input
                                        className={styles.dictInput}
                                        type="text"
                                        placeholder={config.placeholder2}
                                        value={input.reading}
                                        onChange={(e) => setInputs(prev => ({
                                            ...prev,
                                            [catKey]: { ...prev[catKey], reading: e.target.value },
                                        }))}
                                        onKeyDown={(e) => handleKeyDown(e, catKey)}
                                    />
                                    <button
                                        className={styles.dictAddBtn}
                                        onClick={() => addTerm(catKey)}
                                        disabled={!input.term.trim()}
                                        style={{ borderColor: config.borderColor, color: config.borderColor }}
                                    >
                                        + 追加
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {totalTerms > 0 && (
                        <p className={styles.help} style={{ marginTop: "0.5rem" }}>
                            合計 {totalTerms} 件の用語が登録されています
                        </p>
                    )}
                </section>

                <div className={styles.actions}>
                    <button
                        className={styles.saveButton}
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? "保存中..." : "設定を保存する"}
                    </button>
                </div>

                {settings.history && settings.history.length > 0 && (
                    <section className={styles.historySection}>
                        <hr className={styles.divider} />
                        <h3>🕒 変更履歴（過去10件）</h3>
                        <div className={styles.historyList}>
                            {settings.history.map((item, index) => (
                                <div key={index} className={styles.historyItem}>
                                    <div className={styles.historyInfo}>
                                        <span className={styles.historyDate}>
                                            {new Date(item.updatedAt).toLocaleString("ja-JP")}
                                        </span>
                                        <span className={styles.historyUser}>{item.updatedBy}</span>
                                    </div>
                                    <button
                                        className={styles.restoreButton}
                                        onClick={() => handleRestore(item)}
                                    >
                                        復元
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
