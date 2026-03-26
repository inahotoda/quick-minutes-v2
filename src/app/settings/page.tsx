"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import styles from "./settings.module.css";

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_USER_EMAIL || "";

export default function SettingsMenuPage() {
    const router = useRouter();
    const { data: session } = useSession();
    const [unresolvedCount, setUnresolvedCount] = useState(0);
    const [features, setFeatures] = useState<{
        drive_save: boolean;
        email_send: boolean;
        terminology_pipeline: boolean;
        profile_analysis: boolean;
    } | null>(null);

    const isAdmin = session?.user?.email === ADMIN_EMAIL;

    useEffect(() => {
        fetch("/api/check-tenant")
            .then(res => res.json())
            .then(data => {
                if (data.features) setFeatures(data.features);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (features?.terminology_pipeline) {
            fetch("/api/terminology/unresolved?count_only=true")
                .then(res => res.json())
                .then(data => { if (data.count > 0) setUnresolvedCount(data.count); })
                .catch(() => {});
        }
    }, [features]);

    return (
        <div className={styles.main}>
            <header className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push("/")}>
                    ← 戻る
                </button>
                <h1 className={styles.title}>設定</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.menuContent}>
                <div className={styles.menuCard} onClick={() => router.push("/settings/prompts")}>
                    <div className={styles.menuIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></div>
                    <div className={styles.menuInfo}>
                        <h2>カスタムプロンプト設定</h2>
                        <p>議事録の生成ルール、モード別の指示、専門用語を設定</p>
                    </div>
                    <div className={styles.menuRight}>
                        {unresolvedCount > 0 && (
                            <span className={styles.unresolvedMenuBadge}>{unresolvedCount}</span>
                        )}
                        <span className={styles.menuArrow}>→</span>
                    </div>
                </div>

                <div className={styles.menuCard} onClick={() => router.push("/settings/members")}>
                    <div className={styles.menuIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
                    <div className={styles.menuInfo}>
                        <h2>メンバー管理</h2>
                        <p>参加者の声を登録して、話者識別の精度を向上</p>
                    </div>
                    <span className={styles.menuArrow}>→</span>
                </div>

                <div className={styles.menuCard} onClick={() => router.push("/settings/presets")}>
                    <div className={styles.menuIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
                    <div className={styles.menuInfo}>
                        <h2>会議プリセット</h2>
                        <p>定例会議を登録して、参加者を自動設定</p>
                    </div>
                    <span className={styles.menuArrow}>→</span>
                </div>

                {isAdmin && features?.profile_analysis && (
                    <div className={styles.menuCard} onClick={() => router.push("/settings/profiles")}>
                        <div className={styles.menuIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
                        <div className={styles.menuInfo}>
                            <h2>人物プロファイル</h2>
                            <p>会議発言からMVV適合度・傾向を分析</p>
                        </div>
                        <span className={styles.menuArrow}>→</span>
                    </div>
                )}

                {isAdmin && (
                    <div className={styles.menuCard} onClick={() => router.push("/settings/tenants")}>
                        <div className={styles.menuIcon}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg></div>
                        <div className={styles.menuInfo}>
                            <h2>モニター企業管理</h2>
                            <p>モニター版を利用する企業・ユーザーを管理</p>
                        </div>
                        <span className={styles.menuArrow}>→</span>
                    </div>
                )}
            </div>
        </div>
    );
}
