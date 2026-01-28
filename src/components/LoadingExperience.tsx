"use client";

import { useState, useEffect } from "react";
import styles from "./LoadingExperience.module.css";

// リフレッシュメッセージ
const REFRESH_MESSAGES = [
    { emoji: "🧘", title: "首のストレッチ", body: "ゆっくり首を左右に傾けて、5秒ずつキープしましょう。肩の力を抜いてリラックス。" },
    { emoji: "🌬️", title: "深呼吸タイム", body: "4秒かけて吸って、7秒止めて、8秒かけて吐く。自律神経が整います。" },
    { emoji: "👀", title: "目を休めよう", body: "20秒間、6メートル先を見つめてみてください。目の疲れが和らぎます。" },
    { emoji: "💧", title: "水分補給", body: "お水を一口飲みましょう。脳の80%は水分でできています。" },
    { emoji: "🙆", title: "肩回し", body: "肩を前に5回、後ろに5回ゆっくり回してみてください。血行が良くなります。" },
    { emoji: "☕", title: "コーヒーブレイク", body: "温かい飲み物を手に持つだけで、心がほっとします。" },
];

// AI未来予報メッセージ
const AI_MESSAGES = [
    { emoji: "🚀", title: "AIと働く時代", body: "2026年、AIは「代替」ではなく「協働」のパートナー。人間の創造性がより重要に。" },
    { emoji: "⚡", title: "Gemini 3の実力", body: "最新のFlashモデルは、従来の10倍高速。あなたの会議も瞬時に要約されます。" },
    { emoji: "🎯", title: "AIで時間を取り戻す", body: "議事録作成の自動化で、年間約50時間を創造的な仕事に使えるようになります。" },
    { emoji: "🌍", title: "グローバルコラボ", body: "AIリアルタイム翻訳で、言語の壁なく世界中のチームと協働できる時代に。" },
    { emoji: "💡", title: "アイデアの民主化", body: "AIが文章を整えてくれるので、誰もが自分のアイデアを伝えやすくなりました。" },
    { emoji: "🔮", title: "働き方の未来", body: "定型業務はAIに任せ、人間は「意思決定」と「関係構築」に集中する時代へ。" },
];

interface LoadingExperienceProps {
    isVisible: boolean;
}

export default function LoadingExperience({ isVisible }: LoadingExperienceProps) {
    const [currentMessage, setCurrentMessage] = useState<{ emoji: string; title: string; body: string } | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [fadeState, setFadeState] = useState<"in" | "out">("in");

    // 初期メッセージとタイマー設定
    useEffect(() => {
        if (!isVisible) {
            setElapsedSeconds(0);
            return;
        }

        // ランダムにメッセージを選択
        const pickRandom = () => {
            const allMessages = [...REFRESH_MESSAGES, ...AI_MESSAGES];
            return allMessages[Math.floor(Math.random() * allMessages.length)];
        };

        setCurrentMessage(pickRandom());
        setFadeState("in");

        // 1秒ごとにカウントアップ
        const timer = setInterval(() => {
            setElapsedSeconds((prev) => prev + 1);
        }, 1000);

        // 30秒ごとにメッセージ切り替え
        const messageTimer = setInterval(() => {
            setFadeState("out");
            setTimeout(() => {
                setCurrentMessage(pickRandom());
                setFadeState("in");
            }, 300);
        }, 30000);

        return () => {
            clearInterval(timer);
            clearInterval(messageTimer);
        };
    }, [isVisible]);

    if (!isVisible || !currentMessage) return null;

    const progressPercent = Math.min((elapsedSeconds / 120) * 100, 100);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.header}>
                    <div className={styles.spinner}></div>
                    <span className={styles.headerText}>Gemini が議事録を作成中...</span>
                </div>

                <div className={styles.progressWrapper}>
                    <div className={styles.progressBar}>
                        <div
                            className={styles.progressFill}
                            style={{ width: `${progressPercent}%` }}
                        ></div>
                    </div>
                    <span className={styles.timer}>
                        {minutes}:{seconds.toString().padStart(2, "0")}
                    </span>
                </div>

                <div className={`${styles.messageCard} ${styles[fadeState]}`}>
                    <div className={styles.messageEmoji}>{currentMessage.emoji}</div>
                    <div className={styles.messageContent}>
                        <h3 className={styles.messageTitle}>{currentMessage.title}</h3>
                        <p className={styles.messageBody}>{currentMessage.body}</p>
                    </div>
                </div>

                <p className={styles.hint}>💡 30秒ごとに新しいヒントが表示されます</p>
            </div>
        </div>
    );
}
