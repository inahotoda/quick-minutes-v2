"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

// --- 用語辞書データ構造（3フィールド） ---
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

const EMPTY_CATEGORIES: TermCategories = {
    companyBrand: [],
    abbreviation: [],
    technical: [],
};

// --- パース: 1行 → TermEntry（新旧フォーマット両対応） ---
function parseSingleTermLine(cleaned: string): TermEntry {
    // 新フォーマット: "用語（読み）— 説明"
    const newFormat = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])\s*[—\-]\s*(.+)$/);
    if (newFormat) return { term: newFormat[1].trim(), reading: newFormat[2].trim(), description: newFormat[3].trim() };

    // 旧フォーマット: "用語（読み）"
    const reading = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
    if (reading) return { term: reading[1].trim(), reading: reading[2].trim(), description: "" };

    // 旧フォーマット: "用語 = 正式名称"
    const eq = cleaned.match(/^(.+?)\s*=\s*(.+)$/);
    if (eq) return { term: eq[1].trim(), reading: "", description: eq[2].trim() };

    return { term: cleaned, reading: "", description: "" };
}

function parseTerminology(raw: string): TermCategories {
    if (!raw || !raw.trim()) return { ...EMPTY_CATEGORIES };
    const categories: TermCategories = { companyBrand: [], abbreviation: [], technical: [] };
    const hasCategories = /^##\s/m.test(raw);

    if (!hasCategories) {
        for (const line of raw.split("\n").filter(l => l.trim())) {
            const cleaned = line.replace(/^[-・]\s*/, "").trim();
            if (cleaned) categories.technical.push(parseSingleTermLine(cleaned));
        }
        return categories;
    }

    let current: keyof TermCategories = "technical";
    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (/^##\s/.test(trimmed)) {
            if (/社名|ブランド/i.test(trimmed)) current = "companyBrand";
            else if (/略語|社内/i.test(trimmed)) current = "abbreviation";
            else if (/専門/i.test(trimmed)) current = "technical";
            continue;
        }
        const cleaned = trimmed.replace(/^[-・]\s*/, "").trim();
        if (cleaned) categories[current].push(parseSingleTermLine(cleaned));
    }
    return categories;
}

function serializeTerminology(categories: TermCategories): string {
    const sections: string[] = [];
    const fmt = (e: TermEntry) => {
        let line = `- ${e.term}`;
        if (e.reading) line += `（${e.reading}）`;
        if (e.description) line += ` — ${e.description}`;
        return line;
    };
    if (categories.companyBrand.length > 0) sections.push(`## 社名・ブランド名\n${categories.companyBrand.map(fmt).join("\n")}`);
    if (categories.abbreviation.length > 0) sections.push(`## 略語・社内用語\n${categories.abbreviation.map(fmt).join("\n")}`);
    if (categories.technical.length > 0) sections.push(`## 専門用語\n${categories.technical.map(fmt).join("\n")}`);
    return sections.join("\n\n");
}

// --- カテゴリ設定 ---
const CATEGORY_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string; border: string }> = {
    companyBrand: { icon: "🏢", label: "社名・ブランド名", color: "#a5b4fc", bg: "rgba(99,102,241,0.15)", border: "rgba(99,102,241,0.3)" },
    abbreviation: { icon: "🔤", label: "略語・社内用語", color: "#6ee7b7", bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.3)" },
    technical: { icon: "🔧", label: "専門用語", color: "#fcd34d", bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.3)" },
};

const CATEGORY_GUESS_TO_KEY: Record<string, keyof TermCategories> = {
    "略語・社内用語": "abbreviation",
    "専門用語": "technical",
    "社名・ブランド名": "companyBrand",
};

// 未解決用語の型
interface UnresolvedTerm {
    id: string;
    term: string;
    supplementary: string | null;
    reading_guess: string | null;
    description_guess: string | null;
    context: string;
    category_guess: string;
    occurrence_count: number;
}

// --- 展開型カードコンポーネント（登録済み用語用） ---
function RegisteredTermCard({
    entry,
    catKey,
    onUpdate,
    onDelete,
}: {
    entry: TermEntry;
    catKey: string;
    onUpdate: (field: keyof TermEntry, value: string) => void;
    onDelete: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const config = CATEGORY_CONFIG[catKey];

    return (
        <div
            className={styles.termCard}
            style={{ borderLeftColor: config?.border || "rgba(255,255,255,0.1)" }}
        >
            <div className={styles.termCardHeader} onClick={() => setExpanded(!expanded)}>
                <span className={styles.termName}>{entry.term}</span>
                {entry.reading && <span className={styles.termReading}>{entry.reading}</span>}
                <span className={styles.termBadge} style={{ background: config?.bg, borderColor: config?.border, color: config?.color }}>
                    {config?.label || catKey}
                </span>
                <span className={styles.termChevron} style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
            </div>
            <div
                ref={contentRef}
                className={styles.termCardBody}
                style={{
                    maxHeight: expanded ? (contentRef.current?.scrollHeight || 200) + 20 : 0,
                    opacity: expanded ? 1 : 0,
                }}
            >
                <div className={styles.termEditGrid}>
                    <label className={styles.termEditLabel}>用語</label>
                    <input className={styles.termEditInput} value={entry.term} onChange={e => onUpdate("term", e.target.value)} />
                    <label className={styles.termEditLabel}>読み</label>
                    <input className={styles.termEditInput} value={entry.reading} onChange={e => onUpdate("reading", e.target.value)} placeholder="読み仮名（任意）" />
                    <label className={styles.termEditLabel}>説明</label>
                    <input className={styles.termEditInput} value={entry.description} onChange={e => onUpdate("description", e.target.value)} placeholder="正式名称・説明（任意）" />
                </div>
                {entry.description && !expanded && null}
                <div className={styles.termActions}>
                    <button className={styles.termDeleteBtn} onClick={(e) => { e.stopPropagation(); onDelete(); }}>削除</button>
                </div>
            </div>
        </div>
    );
}

// --- 展開型カードコンポーネント（未解決用語用） ---
function UnresolvedTermCard({
    item,
    onRegister,
    onIgnore,
    isResolving,
}: {
    item: UnresolvedTerm;
    onRegister: (id: string, category: string, term: string, reading: string, description: string) => void;
    onIgnore: (id: string) => void;
    isResolving: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const [category, setCategory] = useState(item.category_guess);
    const [reading, setReading] = useState(item.reading_guess || "");
    const [description, setDescription] = useState(item.description_guess || item.supplementary || "");
    const catKey = CATEGORY_GUESS_TO_KEY[category] || "technical";
    const config = CATEGORY_CONFIG[catKey];

    return (
        <div className={styles.termCard} style={{ borderLeftColor: "#f59e0b" }}>
            <div className={styles.termCardHeader} onClick={() => setExpanded(!expanded)}>
                <span className={styles.termName}>{item.term}</span>
                <span className={styles.termBadge} style={{ background: config?.bg, borderColor: config?.border, color: config?.color }}>
                    {category}
                </span>
                {item.occurrence_count > 1 && (
                    <span className={styles.termOccurrence}>{item.occurrence_count}回</span>
                )}
                <div className={styles.termQuickActions}>
                    <button
                        className={styles.termQuickRegister}
                        onClick={(e) => { e.stopPropagation(); onRegister(item.id, category, item.term, reading, description); }}
                        disabled={isResolving}
                        title="登録する"
                    >
                        {isResolving ? "..." : "✓"}
                    </button>
                    <button
                        className={styles.termQuickIgnore}
                        onClick={(e) => { e.stopPropagation(); onIgnore(item.id); }}
                        disabled={isResolving}
                        title="不要"
                    >
                        ✕
                    </button>
                </div>
                <span className={styles.termChevron} style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>▼</span>
            </div>
            <div
                ref={contentRef}
                className={styles.termCardBody}
                style={{
                    maxHeight: expanded ? (contentRef.current?.scrollHeight || 300) + 20 : 0,
                    opacity: expanded ? 1 : 0,
                }}
            >
                <div className={styles.termEditGrid}>
                    <label className={styles.termEditLabel}>読み</label>
                    <input className={styles.termEditInput} value={reading} onChange={e => setReading(e.target.value)} placeholder="読み仮名（任意）" />
                    <label className={styles.termEditLabel}>説明</label>
                    <input className={styles.termEditInput} value={description} onChange={e => setDescription(e.target.value)} placeholder="正式名称・説明（任意）" />
                    <label className={styles.termEditLabel}>カテゴリ</label>
                    <select className={styles.termEditInput} value={category} onChange={e => setCategory(e.target.value)}>
                        <option value="社名・ブランド名">🏢 社名・ブランド名</option>
                        <option value="略語・社内用語">🔤 略語・社内用語</option>
                        <option value="専門用語">🔧 専門用語</option>
                    </select>
                </div>
                {item.context && (
                    <p className={styles.termContext}>
                        💬 {item.context}
                    </p>
                )}
                <div className={styles.termActions}>
                    <button
                        className={styles.termRegisterBtn}
                        onClick={(e) => { e.stopPropagation(); onRegister(item.id, category, item.term, reading, description); }}
                        disabled={isResolving}
                    >
                        {isResolving ? "登録中..." : "登録する"}
                    </button>
                    <button
                        className={styles.termIgnoreBtn}
                        onClick={(e) => { e.stopPropagation(); onIgnore(item.id); }}
                        disabled={isResolving}
                    >
                        不要
                    </button>
                </div>
            </div>
        </div>
    );
}

// =======================================================
// メインページ
// =======================================================
export default function PromptsSettingsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [isIkpManaged, setIsIkpManaged] = useState(false);

    useEffect(() => {
        fetch("/api/check-tenant")
            .then(r => r.json())
            .then(data => {
                if (data.tenantId === "inaho") setIsIkpManaged(true);
            })
            .catch(() => {});
    }, []);

    const [settings, setSettings] = useState<PromptConfig>({
        basePrompt: "", internalPrompt: "", businessPrompt: "", otherPrompt: "", terminology: "",
    });
    const [savedSettings, setSavedSettings] = useState<PromptConfig>({
        basePrompt: "", internalPrompt: "", businessPrompt: "", otherPrompt: "", terminology: "",
    });
    const [savedTermCategories, setSavedTermCategories] = useState<TermCategories>({ ...EMPTY_CATEGORIES });
    const [termCategories, setTermCategories] = useState<TermCategories>({ ...EMPTY_CATEGORIES });

    // 未解決用語
    const [unresolvedTerms, setUnresolvedTerms] = useState<UnresolvedTerm[]>([]);
    const [resolvingId, setResolvingId] = useState<string | null>(null);

    // 新規追加フォーム
    const [showAddForm, setShowAddForm] = useState(false);
    const [newTerm, setNewTerm] = useState<TermEntry & { category: keyof TermCategories }>({
        term: "", reading: "", description: "", category: "technical",
    });

    // 変更検知
    const hasUnsavedChanges = useCallback(() => {
        if (settings.basePrompt !== savedSettings.basePrompt) return true;
        if (settings.internalPrompt !== savedSettings.internalPrompt) return true;
        if (settings.businessPrompt !== savedSettings.businessPrompt) return true;
        if (settings.otherPrompt !== savedSettings.otherPrompt) return true;
        if (JSON.stringify(termCategories) !== JSON.stringify(savedTermCategories)) return true;
        return false;
    }, [settings, savedSettings, termCategories, savedTermCategories]);

    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => { if (hasUnsavedChanges()) e.preventDefault(); };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [hasUnsavedChanges]);

    useEffect(() => {
        async function fetchPrompts() {
            try {
                const res = await fetch("/api/prompts");
                if (res.ok) {
                    const data = await res.json();
                    setSettings(data);
                    setSavedSettings(data);
                    const parsed = parseTerminology(data.terminology || "");
                    setTermCategories(parsed);
                    setSavedTermCategories(parsed);
                }
            } catch (err) {
                console.error("Failed to fetch prompts:", err);
            } finally {
                setLoading(false);
            }
        }
        fetchPrompts();
    }, []);

    useEffect(() => {
        fetch("/api/terminology/unresolved")
            .then(res => res.json())
            .then(data => { if (data.items) setUnresolvedTerms(data.items); })
            .catch(() => {});
    }, []);

    // 登録済み用語を編集
    const updateTerm = useCallback((catKey: keyof TermCategories, index: number, field: keyof TermEntry, value: string) => {
        setTermCategories(prev => ({
            ...prev,
            [catKey]: prev[catKey].map((entry, i) => i === index ? { ...entry, [field]: value } : entry),
        }));
    }, []);

    // 登録済み用語を削除
    const removeTerm = useCallback((catKey: keyof TermCategories, index: number) => {
        setTermCategories(prev => ({
            ...prev,
            [catKey]: prev[catKey].filter((_, i) => i !== index),
        }));
    }, []);

    // 新規用語を追加
    const addNewTerm = useCallback(() => {
        if (!newTerm.term.trim()) return;
        setTermCategories(prev => ({
            ...prev,
            [newTerm.category]: [...prev[newTerm.category], { term: newTerm.term.trim(), reading: newTerm.reading.trim(), description: newTerm.description.trim() }],
        }));
        setNewTerm({ term: "", reading: "", description: "", category: "technical" });
        setShowAddForm(false);
    }, [newTerm]);

    // 未解決用語を登録
    const handleRegister = async (id: string, category: string, term: string, reading: string, description: string) => {
        setResolvingId(id);
        try {
            const res = await fetch("/api/terminology/resolve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, action: "register", category, term, reading, description }),
            });
            if (res.ok) {
                setUnresolvedTerms(prev => prev.filter(t => t.id !== id));
                const catKey = CATEGORY_GUESS_TO_KEY[category];
                if (catKey) {
                    setTermCategories(prev => ({
                        ...prev,
                        [catKey]: [...prev[catKey], { term, reading, description }],
                    }));
                    setSavedTermCategories(prev => ({
                        ...prev,
                        [catKey]: [...prev[catKey], { term, reading, description }],
                    }));
                }
                setToast("辞書に登録しました");
                setTimeout(() => setToast(null), 3000);
            }
        } catch {}
        setResolvingId(null);
    };

    // 未解決用語を無視
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

    // 全て登録
    const handleRegisterAll = async () => {
        if (unresolvedTerms.length === 0) return;
        setResolvingId("all");
        try {
            for (const item of unresolvedTerms) {
                await fetch("/api/terminology/resolve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        id: item.id,
                        action: "register",
                        category: item.category_guess,
                        term: item.term,
                        reading: item.reading_guess || "",
                        description: item.description_guess || item.supplementary || "",
                    }),
                });
            }
            // ローカル状態も更新
            for (const item of unresolvedTerms) {
                const catKey = CATEGORY_GUESS_TO_KEY[item.category_guess];
                if (catKey) {
                    setTermCategories(prev => ({
                        ...prev,
                        [catKey]: [...prev[catKey], { term: item.term, reading: item.reading_guess || "", description: item.description_guess || item.supplementary || "" }],
                    }));
                    setSavedTermCategories(prev => ({
                        ...prev,
                        [catKey]: [...prev[catKey], { term: item.term, reading: item.reading_guess || "", description: item.description_guess || item.supplementary || "" }],
                    }));
                }
            }
            setUnresolvedTerms([]);
            setToast(`${unresolvedTerms.length}件の用語を辞書に登録しました`);
            setTimeout(() => setToast(null), 3000);
        } catch {}
        setResolvingId(null);
    };

    // 保存
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
                setSavedSettings(newData.config);
                const parsed = parseTerminology(newData.config.terminology || "");
                setTermCategories(parsed);
                setSavedTermCategories(parsed);
                setMessage({ type: "success", text: "設定を保存しました" });
                setTimeout(() => setMessage(null), 3000);
            } else {
                throw new Error("Save failed");
            }
        } catch {
            setMessage({ type: "error", text: "保存に失敗しました" });
        } finally {
            setSaving(false);
        }
    };

    const handleRestore = (oldVersion: any) => {
        if (confirm("このバージョンの内容を表示しますか？（現在の編集内容は上書きされます）")) {
            setSettings({ ...settings, basePrompt: oldVersion.basePrompt, internalPrompt: oldVersion.internalPrompt, businessPrompt: oldVersion.businessPrompt, otherPrompt: oldVersion.otherPrompt, terminology: oldVersion.terminology });
            setTermCategories(parseTerminology(oldVersion.terminology || ""));
            window.scrollTo({ top: 0, behavior: "smooth" });
            setMessage({ type: "success", text: "履歴から復元しました（「保存」するまで確定されません）" });
        }
    };

    if (loading) {
        return <div className={styles.loading}><div className={styles.spinner} /><p>読み込み中...</p></div>;
    }

    const totalTerms = termCategories.companyBrand.length + termCategories.abbreviation.length + termCategories.technical.length;

    // 登録済み用語をフラットリストに変換
    const allRegisteredTerms: { entry: TermEntry; catKey: keyof TermCategories; index: number }[] = [];
    for (const catKey of ["companyBrand", "abbreviation", "technical"] as (keyof TermCategories)[]) {
        termCategories[catKey].forEach((entry, index) => {
            allRegisteredTerms.push({ entry, catKey, index });
        });
    }

    return (
        <div className={styles.main}>
            <header className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push("/settings")}>← 設定に戻る</button>
                <h1 className={styles.title}>カスタムプロンプト設定</h1>
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
                    <textarea value={settings.basePrompt} onChange={e => setSettings({ ...settings, basePrompt: e.target.value })} placeholder="あなたは優秀な議事録作成アシスタントです。..." rows={8} />
                </section>

                <section className={styles.section}>
                    <h2>社内MTGモード</h2>
                    <p className={styles.help}>「社内」モード選択時に追加される指示です。</p>
                    <textarea value={settings.internalPrompt} onChange={e => setSettings({ ...settings, internalPrompt: e.target.value })} placeholder="決定事項とアクションアイテムを優先的に抽出してください。..." rows={5} />
                </section>

                <section className={styles.section}>
                    <h2>商談モード</h2>
                    <p className={styles.help}>「商談」モード選択時に追加される指示です。</p>
                    <textarea value={settings.businessPrompt} onChange={e => setSettings({ ...settings, businessPrompt: e.target.value })} placeholder="顧客の課題、提案への反応、ネクストアクションを整理してください。..." rows={5} />
                </section>

                {/* ===== 用語辞書 ===== */}
                <section className={styles.section}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <h2>📖 用語辞書 {totalTerms > 0 && <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>({totalTerms}件)</span>}</h2>
                        {!isIkpManaged && (
                            <button
                                className={styles.termAddNewBtn}
                                onClick={() => setShowAddForm(!showAddForm)}
                            >
                                {showAddForm ? "✕ 閉じる" : "+ 新規追加"}
                            </button>
                        )}
                    </div>
                    <p className={styles.help}>
                        音声で正しく認識されにくい固有名詞や専門用語を登録すると、議事録の精度が向上します。
                    </p>
                    {isIkpManaged && (
                        <div style={{
                            padding: "0.75rem 1rem",
                            background: "rgba(99,102,241,0.08)",
                            border: "1px solid rgba(99,102,241,0.2)",
                            borderRadius: 10,
                            marginBottom: "1rem",
                            fontSize: "0.82rem",
                            color: "rgba(255,255,255,0.6)",
                            lineHeight: 1.5,
                        }}>
                            用語辞書の追加・編集は <strong style={{ color: "#a5b4fc" }}><a href="https://inaho-knowledge-portal.vercel.app/terminology" target="_blank" rel="noopener noreferrer" style={{ color: "#a5b4fc", textDecoration: "underline" }}>INAHO Knowledge Portal</a></strong> から行えます。
                            会議から自動抽出された「確認待ち」用語はここから登録・不要の判断ができます。
                        </div>
                    )}

                    {/* 新規追加フォーム（モニター企業のみ） */}
                    {!isIkpManaged && showAddForm && (
                        <div className={styles.termAddForm}>
                            <div className={styles.termEditGrid}>
                                <label className={styles.termEditLabel}>用語</label>
                                <input className={styles.termEditInput} value={newTerm.term} onChange={e => setNewTerm({ ...newTerm, term: e.target.value })} placeholder="例: YANUK" autoFocus />
                                <label className={styles.termEditLabel}>読み</label>
                                <input className={styles.termEditInput} value={newTerm.reading} onChange={e => setNewTerm({ ...newTerm, reading: e.target.value })} placeholder="例: やぬーく（任意）" />
                                <label className={styles.termEditLabel}>説明</label>
                                <input className={styles.termEditInput} value={newTerm.description} onChange={e => setNewTerm({ ...newTerm, description: e.target.value })} placeholder="例: デニムブランド（任意）" />
                                <label className={styles.termEditLabel}>カテゴリ</label>
                                <select className={styles.termEditInput} value={newTerm.category} onChange={e => setNewTerm({ ...newTerm, category: e.target.value as keyof TermCategories })}>
                                    <option value="companyBrand">🏢 社名・ブランド名</option>
                                    <option value="abbreviation">🔤 略語・社内用語</option>
                                    <option value="technical">🔧 専門用語</option>
                                </select>
                            </div>
                            <button className={styles.termRegisterBtn} onClick={addNewTerm} disabled={!newTerm.term.trim()}>
                                追加する
                            </button>
                        </div>
                    )}

                    {/* 未解決の用語 */}
                    {unresolvedTerms.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "#fbbf24" }}>❓ 確認待ち</span>
                                    <span className={styles.termPendingBadge}>{unresolvedTerms.length}件</span>
                                </div>
                                <button
                                    className={styles.termRegisterAllBtn}
                                    onClick={handleRegisterAll}
                                    disabled={resolvingId === "all"}
                                >
                                    {resolvingId === "all" ? "登録中..." : "全て登録"}
                                </button>
                            </div>
                            <div className={styles.termCardList}>
                                {unresolvedTerms.map(item => (
                                    <UnresolvedTermCard
                                        key={item.id}
                                        item={item}
                                        onRegister={handleRegister}
                                        onIgnore={handleIgnore}
                                        isResolving={resolvingId === item.id}
                                    />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 登録済みの用語 */}
                    {allRegisteredTerms.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                            <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "rgba(255,255,255,0.6)" }}>
                                登録済み ({totalTerms}件)
                            </span>
                            <div className={styles.termCardList} style={{ marginTop: 8 }}>
                                {isIkpManaged ? (
                                    // INAHO: 読み取り専用表示
                                    allRegisteredTerms.map(({ entry, catKey, index }) => {
                                        const config = CATEGORY_CONFIG[catKey];
                                        return (
                                            <div
                                                key={`${catKey}-${index}`}
                                                className={styles.termCard}
                                                style={{ borderLeftColor: config?.border || "rgba(255,255,255,0.1)" }}
                                            >
                                                <div className={styles.termCardHeader}>
                                                    <span className={styles.termName}>{entry.term}</span>
                                                    {entry.reading && <span className={styles.termReading}>{entry.reading}</span>}
                                                    <span className={styles.termBadge} style={{ background: config?.bg, borderColor: config?.border, color: config?.color }}>
                                                        {config?.label || catKey}
                                                    </span>
                                                </div>
                                                {entry.description && (
                                                    <div style={{ padding: "0 12px 8px", fontSize: "0.78rem", color: "rgba(255,255,255,0.4)" }}>
                                                        {entry.description}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                ) : (
                                    // モニター企業: 編集可能カード
                                    allRegisteredTerms.map(({ entry, catKey, index }) => (
                                        <RegisteredTermCard
                                            key={`${catKey}-${index}`}
                                            entry={entry}
                                            catKey={catKey}
                                            onUpdate={(field, value) => updateTerm(catKey, index, field, value)}
                                            onDelete={() => removeTerm(catKey, index)}
                                        />
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </section>

                {/* 保存ボタン */}
                <div className={styles.actions}>
                    <button className={styles.saveButton} onClick={handleSave} disabled={saving}>
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
                                        <span className={styles.historyDate}>{new Date(item.updatedAt).toLocaleString("ja-JP")}</span>
                                        <span className={styles.historyUser}>{item.updatedBy}</span>
                                    </div>
                                    <button className={styles.restoreButton} onClick={() => handleRestore(item)}>復元</button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>

            {/* フローティング保存バー */}
            {hasUnsavedChanges() && (
                <div className={styles.floatingSaveBar}>
                    <span>未保存の変更があります</span>
                    <button className={styles.floatingSaveBtn} onClick={handleSave} disabled={saving}>
                        {saving ? "保存中..." : "保存する"}
                    </button>
                </div>
            )}

            {/* トースト通知 */}
            {toast && <div className={styles.toast}>✅ {toast}</div>}
        </div>
    );
}
