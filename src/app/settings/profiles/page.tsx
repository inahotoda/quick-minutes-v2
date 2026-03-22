"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import styles from "../settings.module.css";

interface ProfileSummary {
    id: string;
    person_name: string;
    period_start: string;
    period_end: string;
    meetings_analyzed: number;
    mvv_v1_score: number | null;
    mvv_v2_score: number | null;
    mvv_v3_score: number | null;
    mvv_overall: number | null;
    low_participation_flag: boolean;
    avg_utterance_count: number | null;
    summary_text: string | null;
    generated_at: string;
}

interface PersonAnalysis {
    person_name: string;
    meeting_date: string;
}

export default function ProfilesPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
    const [knownPersons, setKnownPersons] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // 期間選択（デフォルト: 今月）
    const now = new Date();
    const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    const [periodStart, setPeriodStart] = useState(defaultStart);
    const [periodEnd, setPeriodEnd] = useState(defaultEnd);

    useEffect(() => {
        async function fetchData() {
            try {
                const res = await fetch("/api/profile");
                if (res.ok) {
                    const data = await res.json();
                    setProfiles(data.profiles || []);
                }
                // 分析済みのユニーク人物名も取得
                const analysisRes = await fetch(`/api/profile/persons`);
                if (analysisRes.ok) {
                    const data = await analysisRes.json();
                    setKnownPersons(data.persons || []);
                }
            } catch {}
            setLoading(false);
        }
        fetchData();
    }, []);

    const handleGenerateAll = async () => {
        setGenerating(true);
        setMessage(null);
        const persons = knownPersons.length > 0 ? knownPersons : profiles.map(p => p.person_name);
        let successCount = 0;

        for (const name of persons) {
            try {
                const res = await fetch("/api/profile/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ personName: name, periodStart, periodEnd }),
                });
                if (res.ok) successCount++;
            } catch {}
        }

        // 再取得
        try {
            const res = await fetch("/api/profile");
            if (res.ok) {
                const data = await res.json();
                setProfiles(data.profiles || []);
            }
        } catch {}

        setMessage({
            type: successCount > 0 ? "success" : "error",
            text: successCount > 0
                ? `${successCount}名のプロファイルを生成しました`
                : "プロファイル生成に失敗しました",
        });
        setGenerating(false);
    };

    const getScoreColor = (score: number | null) => {
        if (score === null) return "rgba(255,255,255,0.3)";
        if (score >= 75) return "#10b981";
        if (score >= 50) return "#f59e0b";
        return "#ef4444";
    };

    const getScoreBar = (score: number | null) => {
        if (score === null) return 0;
        return Math.min(100, Math.max(0, score));
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
                <h1 className={styles.title}>👤 人物プロファイル</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.content}>
                <div className={styles.profileDisclaimer}>
                    この分析は会議発言のデータに基づきます。現場作業での貢献は反映されません。
                </div>

                {message && (
                    <div className={`${styles.alert} ${styles[message.type]}`}>
                        {message.type === "success" ? "✅" : "⚠️"} {message.text}
                    </div>
                )}

                <div className={styles.profileControls}>
                    <div className={styles.profilePeriod}>
                        <label>期間:</label>
                        <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className={styles.profileDateInput} />
                        <span>〜</span>
                        <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={styles.profileDateInput} />
                    </div>
                    <button
                        className={styles.profileGenerateBtn}
                        onClick={handleGenerateAll}
                        disabled={generating || knownPersons.length === 0}
                    >
                        {generating ? "生成中..." : "プロファイル生成"}
                    </button>
                </div>

                {profiles.length === 0 && !generating ? (
                    <div className={styles.emptyState}>
                        <p>プロファイルがまだありません。</p>
                        <p style={{ fontSize: "0.85rem", marginTop: "0.5rem" }}>
                            議事録を生成すると分析データが蓄積され、プロファイルを生成できるようになります。
                        </p>
                    </div>
                ) : (
                    <div className={styles.profileList}>
                        {profiles.map(p => (
                            <div
                                key={p.id}
                                className={styles.profileCard}
                                onClick={() => router.push(`/settings/profiles/${encodeURIComponent(p.person_name)}`)}
                            >
                                <div className={styles.profileCardHeader}>
                                    <span className={styles.profileName}>{p.person_name}</span>
                                    {p.low_participation_flag && (
                                        <span className={styles.profileLowFlag}>発言量不足</span>
                                    )}
                                </div>

                                {p.mvv_overall !== null ? (
                                    <div className={styles.profileScores}>
                                        <div className={styles.profileScoreItem}>
                                            <span className={styles.profileScoreLabel}>V1</span>
                                            <div className={styles.profileScoreBar}>
                                                <div
                                                    className={styles.profileScoreFill}
                                                    style={{
                                                        width: `${getScoreBar(p.mvv_v1_score)}%`,
                                                        background: getScoreColor(p.mvv_v1_score),
                                                    }}
                                                />
                                            </div>
                                            <span className={styles.profileScoreValue} style={{ color: getScoreColor(p.mvv_v1_score) }}>
                                                {p.mvv_v1_score ?? "—"}
                                            </span>
                                        </div>
                                        <div className={styles.profileScoreItem}>
                                            <span className={styles.profileScoreLabel}>V2</span>
                                            <div className={styles.profileScoreBar}>
                                                <div
                                                    className={styles.profileScoreFill}
                                                    style={{
                                                        width: `${getScoreBar(p.mvv_v2_score)}%`,
                                                        background: getScoreColor(p.mvv_v2_score),
                                                    }}
                                                />
                                            </div>
                                            <span className={styles.profileScoreValue} style={{ color: getScoreColor(p.mvv_v2_score) }}>
                                                {p.mvv_v2_score ?? "—"}
                                            </span>
                                        </div>
                                        <div className={styles.profileScoreItem}>
                                            <span className={styles.profileScoreLabel}>V3</span>
                                            <div className={styles.profileScoreBar}>
                                                <div
                                                    className={styles.profileScoreFill}
                                                    style={{
                                                        width: `${getScoreBar(p.mvv_v3_score)}%`,
                                                        background: getScoreColor(p.mvv_v3_score),
                                                    }}
                                                />
                                            </div>
                                            <span className={styles.profileScoreValue} style={{ color: getScoreColor(p.mvv_v3_score) }}>
                                                {p.mvv_v3_score ?? "—"}
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className={styles.profileDataInsufficient}>データ蓄積中</p>
                                )}

                                <div className={styles.profileCardMeta}>
                                    {p.meetings_analyzed}件の議事録 | {new Date(p.generated_at).toLocaleDateString("ja-JP")}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
