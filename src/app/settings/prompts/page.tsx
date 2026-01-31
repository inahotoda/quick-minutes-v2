"use client";

import { useState, useEffect } from "react";
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

    useEffect(() => {
        async function fetchPrompts() {
            try {
                const res = await fetch("/api/prompts");
                if (res.ok) {
                    const data = await res.json();
                    setSettings(data);
                }
            } catch (err) {
                console.error("Failed to fetch prompts:", err);
            } finally {
                setLoading(false);
            }
        }
        fetchPrompts();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const { history: _, updatedBy: __, updatedAt: ___, ...dataToSave } = settings;
            const res = await fetch("/api/prompts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(dataToSave),
            });
            if (res.ok) {
                const newData = await res.json();
                setSettings(newData.config);
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
            window.scrollTo({ top: 0, behavior: "smooth" });
            setMessage({ type: "success", text: "履歴から復元しました（「保存」するまで確定されません）" });
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

                <section className={styles.section}>
                    <h2>専門用語・固有名詞・参加者名</h2>
                    <p className={styles.help}>
                        誤字変換を防ぎたい会社名や専門用語を登録します。<br />
                        <strong>💡 ヒント：参加者名を登録すると話者識別の精度が上がります。</strong><br />
                        会議冒頭で「〇〇です」と自己紹介するルールにすると、より正確に識別できます。
                    </p>
                    <textarea
                        value={settings.terminology}
                        onChange={(e) => setSettings({ ...settings, terminology: e.target.value })}
                        placeholder="INAHO, 生成AI, プロンプトエンジニアリング, 田中太郎, 佐藤花子, ..."
                        rows={5}
                    />
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
