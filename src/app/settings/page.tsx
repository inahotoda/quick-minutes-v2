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
                <h1 className={styles.title}>⚙️ 設定</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.menuContent}>
                <div className={styles.menuCard} onClick={() => router.push("/settings/prompts")}>
                    <div className={styles.menuIcon}>📝</div>
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
                    <div className={styles.menuIcon}>👥</div>
                    <div className={styles.menuInfo}>
                        <h2>メンバー管理</h2>
                        <p>参加者の声を登録して、話者識別の精度を向上</p>
                    </div>
                    <span className={styles.menuArrow}>→</span>
                </div>

                <div className={styles.menuCard} onClick={() => router.push("/settings/presets")}>
                    <div className={styles.menuIcon}>📅</div>
                    <div className={styles.menuInfo}>
                        <h2>会議プリセット</h2>
                        <p>定例会議を登録して、参加者を自動設定</p>
                    </div>
                    <span className={styles.menuArrow}>→</span>
                </div>

                {isAdmin && features?.profile_analysis && (
                    <div className={styles.menuCard} onClick={() => router.push("/settings/profiles")}>
                        <div className={styles.menuIcon}>👤</div>
                        <div className={styles.menuInfo}>
                            <h2>人物プロファイル</h2>
                            <p>会議発言からMVV適合度・傾向を分析</p>
                        </div>
                        <span className={styles.menuArrow}>→</span>
                    </div>
                )}

                {isAdmin && (
                    <div className={styles.menuCard} onClick={() => router.push("/settings/tenants")}>
                        <div className={styles.menuIcon}>🏢</div>
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
