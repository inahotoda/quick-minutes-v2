"use client";

import { useRouter } from "next/navigation";
import styles from "./settings.module.css";

export default function SettingsMenuPage() {
    const router = useRouter();

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
                    <span className={styles.menuArrow}>→</span>
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

                {process.env.NEXT_PUBLIC_DEPLOYMENT_MODE !== "trial" && (
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
