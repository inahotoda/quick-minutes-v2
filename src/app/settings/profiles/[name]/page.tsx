"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import styles from "../../settings.module.css";

interface MvvValueDetail {
    score: number | null;
    trend: string;
    top_positive: string[];
    top_negative: string[];
    summary: string;
}

interface ThemeItem {
    theme: string;
    frequency: number;
    sample: string;
}

interface Profile {
    id: string;
    person_name: string;
    period_start: string;
    period_end: string;
    meetings_analyzed: number;
    mvv_v1_score: number | null;
    mvv_v2_score: number | null;
    mvv_v3_score: number | null;
    mvv_overall: number | null;
    mvv_detail: {
        v1_change?: MvvValueDetail;
        v2_team?: MvvValueDetail;
        v3_thanks?: MvvValueDetail;
    };
    affinity_profile: {
        positive_themes?: ThemeItem[];
        negative_themes?: ThemeItem[];
        recommendation?: string;
    };
    avg_utterance_count: number | null;
    avg_utterance_ratio: number | null;
    utterance_trend: string | null;
    low_participation_flag: boolean;
    summary_text: string | null;
    assignment_recommendation: string | null;
    generated_at: string;
}

const MVV_CONFIG = [
    { key: "v1_change" as const, label: "V1 変化を楽しむ", scoreKey: "mvv_v1_score" as const },
    { key: "v2_team" as const, label: "V2 チームで勝つ", scoreKey: "mvv_v2_score" as const },
    { key: "v3_thanks" as const, label: "V3 最後に「ありがとう」をもらう", scoreKey: "mvv_v3_score" as const },
];

const TREND_ICON: Record<string, string> = {
    improving: "↑",
    stable: "→",
    declining: "↓",
    initial: "●",
    increasing: "↑",
    decreasing: "↓",
};

export default function ProfileDetailPage() {
    const router = useRouter();
    const params = useParams();
    const personName = decodeURIComponent(params.name as string);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchProfile() {
            try {
                const res = await fetch(`/api/profile?person_name=${encodeURIComponent(personName)}`);
                if (res.ok) {
                    const data = await res.json();
                    setProfile(data.profile || null);
                }
            } catch {}
            setLoading(false);
        }
        fetchProfile();
    }, [personName]);

    const getScoreColor = (score: number | null) => {
        if (score === null) return "rgba(255,255,255,0.3)";
        if (score >= 75) return "#10b981";
        if (score >= 50) return "#f59e0b";
        return "#ef4444";
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>読み込み中...</p>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className={styles.main}>
                <header className={styles.header}>
                    <button className={styles.backButton} onClick={() => router.push("/settings/profiles")}>
                        ← 一覧に戻る
                    </button>
                    <h1 className={styles.title}>{personName}</h1>
                    <div style={{ width: 80 }}></div>
                </header>
                <div className={styles.content}>
                    <div className={styles.emptyState}>
                        <p>プロファイルがまだ生成されていません。</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.main}>
            <header className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push("/settings/profiles")}>
                    ← 一覧に戻る
                </button>
                <h1 className={styles.title}>{personName}</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.content}>
                <div className={styles.profileDisclaimer}>
                    この分析は会議発言のデータに基づきます。現場作業での貢献は反映されません。
                </div>

                <div className={styles.profileDetailMeta}>
                    {profile.period_start} 〜 {profile.period_end} | {profile.meetings_analyzed}件の議事録
                </div>

                {/* MVV適合度 */}
                <section className={styles.section}>
                    <h2>MVV適合度</h2>
                    <div className={styles.mvvSection}>
                        {MVV_CONFIG.map(({ key, label, scoreKey }) => {
                            const detail = profile.mvv_detail?.[key];
                            const score = profile[scoreKey];
                            return (
                                <div key={key} className={styles.mvvItem}>
                                    <div className={styles.mvvItemHeader}>
                                        <span className={styles.mvvLabel}>{label}</span>
                                        <span className={styles.mvvScore} style={{ color: getScoreColor(score) }}>
                                            {score !== null ? `${score} / 100` : "データ不足"}
                                            {detail?.trend && ` ${TREND_ICON[detail.trend] || ""}`}
                                        </span>
                                    </div>
                                    {score !== null && (
                                        <div className={styles.profileScoreBar} style={{ marginBottom: "0.5rem" }}>
                                            <div
                                                className={styles.profileScoreFill}
                                                style={{ width: `${score}%`, background: getScoreColor(score) }}
                                            />
                                        </div>
                                    )}
                                    {detail && (
                                        <div className={styles.mvvSignals}>
                                            {detail.top_positive?.map((s, i) => (
                                                <div key={`p${i}`} className={styles.mvvSignalPositive}>✅ {s}</div>
                                            ))}
                                            {detail.top_negative?.map((s, i) => (
                                                <div key={`n${i}`} className={styles.mvvSignalNegative}>⚠️ {s}</div>
                                            ))}
                                            {detail.summary && (
                                                <p className={styles.mvvSummary}>{detail.summary}</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </section>

                {/* ポジティブ/ネガティブ傾向 */}
                <section className={styles.section}>
                    <h2>ポジティブ/ネガティブ傾向</h2>
                    <div className={styles.affinitySection}>
                        {profile.affinity_profile?.positive_themes && profile.affinity_profile.positive_themes.length > 0 && (
                            <div className={styles.affinityGroup}>
                                <h3 className={styles.affinityPositiveTitle}>ポジティブ</h3>
                                {profile.affinity_profile.positive_themes.map((t, i) => (
                                    <div key={i} className={styles.affinityItem}>
                                        <span className={styles.affinityTheme}>{t.theme}</span>
                                        <span className={styles.affinityFreq}>（{t.frequency}回）</span>
                                        <p className={styles.affinitySample}>{t.sample}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                        {profile.affinity_profile?.negative_themes && profile.affinity_profile.negative_themes.length > 0 && (
                            <div className={styles.affinityGroup}>
                                <h3 className={styles.affinityNegativeTitle}>ネガティブ</h3>
                                {profile.affinity_profile.negative_themes.map((t, i) => (
                                    <div key={i} className={styles.affinityItem}>
                                        <span className={styles.affinityTheme}>{t.theme}</span>
                                        <span className={styles.affinityFreq}>（{t.frequency}回）</span>
                                        <p className={styles.affinitySample}>{t.sample}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                {/* 配属推奨 */}
                {profile.assignment_recommendation && (
                    <section className={styles.section}>
                        <h2>配属推奨</h2>
                        <p className={styles.profileText}>{profile.assignment_recommendation}</p>
                    </section>
                )}

                {/* 発言量 */}
                <section className={styles.section}>
                    <h2>発言量</h2>
                    <div className={styles.utteranceStats}>
                        <span>平均 {profile.avg_utterance_count?.toFixed(1) ?? "—"}回/会議</span>
                        <span>占有率 {profile.avg_utterance_ratio ? `${(profile.avg_utterance_ratio * 100).toFixed(0)}%` : "—"}</span>
                        <span>{TREND_ICON[profile.utterance_trend || ""] || ""} {profile.utterance_trend === "increasing" ? "増加" : profile.utterance_trend === "decreasing" ? "減少" : "安定"}</span>
                    </div>
                    {profile.low_participation_flag && (
                        <div className={styles.lowParticipationWarning}>
                            ⚠️ 発言量が少ないメンバーです（平均 {profile.avg_utterance_count?.toFixed(1)}回/会議）
                            <div className={styles.lowParticipationActions}>
                                <p>(a) 発言の機会を意図的に作る（ファシリテーターが指名する等）</p>
                                <p>(b) 発言を促す仕組みを導入（事前に意見を書いてもらう等）</p>
                                <p>(c) 会議への参加自体を見直す（作業に集中させる）</p>
                            </div>
                        </div>
                    )}
                </section>

                {/* 総合プロファイル */}
                {profile.summary_text && (
                    <section className={styles.section}>
                        <h2>総合プロファイル</h2>
                        <p className={styles.profileText}>{profile.summary_text}</p>
                    </section>
                )}
            </div>
        </div>
    );
}
