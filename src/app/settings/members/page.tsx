"use client";

import { useRouter } from "next/navigation";
import MemberManager from "@/components/member/MemberManager";
import styles from "../settings.module.css";

export default function MembersPage() {
    const router = useRouter();

    return (
        <div className={styles.main}>
            <header className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push("/settings")}>
                    ← 戻る
                </button>
                <h1 className={styles.title}>メンバー管理</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.content}>
                <p className={styles.help}>
                    参加者の名前と自己紹介音声を登録すると、議事録生成時の話者識別精度が向上します。
                </p>

                <MemberManager />
            </div>
        </div>
    );
}
