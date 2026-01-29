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

                <div className={styles.menuCard} onClick={() => router.push("/settings/speakers")}>
                    <div className={styles.menuIcon}>🎤</div>
                    <div className={styles.menuInfo}>
                        <h2>話者登録</h2>
                        <p>メンバーの声を登録して、議事録の話者識別精度を向上</p>
                    </div>
                    <span className={styles.menuArrow}>→</span>
                </div>
            </div>
        </div>
    );
}
