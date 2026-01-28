"use client";

import { useState, useEffect } from "react";
import styles from "./ProcessingScreen.module.css";

// リフレッシュ＆AI豆知識メッセージ
const MESSAGES = [
    { emoji: "🧘", text: "ゆっくり深呼吸してみましょう。4秒吸って、4秒止めて、4秒で吐く。" },
    { emoji: "👀", text: "遠くを見つめて目を休ませましょう。20秒で疲れが和らぎます。" },
    { emoji: "💧", text: "水分補給のチャンスです。脳の80%は水分でできています。" },
    { emoji: "🙆", text: "肩をゆっくり回してストレッチ。血行が良くなりますよ。" },
    { emoji: "🚀", text: "AIは仕事を奪うのではなく、あなたの創造性を拡張するパートナーです。" },
    { emoji: "⚡", text: "議事録の自動化で、年間約50時間を創造的な仕事に使えます。" },
    { emoji: "🌍", text: "AIリアルタイム翻訳で、言語の壁なく世界中と協働できる時代に。" },
    { emoji: "💡", text: "定型業務はAIに任せ、人間は意思決定と関係構築に集中しましょう。" },
    { emoji: "🎯", text: "会議の価値は「決定」と「次のアクション」。AIがそれを逃しません。" },
    { emoji: "☕", text: "少し席を立って、コーヒーや紅茶を淹れてきませんか？" },
];

export default function ProcessingScreen() {
    const [currentMessage, setCurrentMessage] = useState(MESSAGES[0]);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [fadeKey, setFadeKey] = useState(0);

    useEffect(() => {
        // タイマー
        const timer = setInterval(() => {
            setElapsedSeconds((prev) => prev + 1);
        }, 1000);

        // メッセージ切り替え（15秒ごと）
        const messageTimer = setInterval(() => {
            setFadeKey((prev) => prev + 1);
            const randomIndex = Math.floor(Math.random() * MESSAGES.length);
            setCurrentMessage(MESSAGES[randomIndex]);
        }, 15000);

        return () => {
            clearInterval(timer);
            clearInterval(messageTimer);
        };
    }, []);

    const totalSeconds = 120;
    const remainingSeconds = Math.max(totalSeconds - elapsedSeconds, 0);
    const progressPercent = Math.min((elapsedSeconds / totalSeconds) * 100, 100);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    return (
        <div className={styles.container}>
            <div className={styles.circle} />

            <div className={styles.messageContainer}>
                <h2 className={styles.mainMessage}>会議、お疲れ様でした！</h2>
                <p className={styles.subMessage}>
                    価値ある対話を、確かな資産に変えています...
                </p>
            </div>

            {/* タイムバー */}
            <div className={styles.timerSection}>
                <div className={styles.countdown}>
                    <span className={styles.timeDigit}>{minutes}</span>
                    <span className={styles.timeSeparator}>:</span>
                    <span className={styles.timeDigit}>{seconds.toString().padStart(2, "0")}</span>
                </div>
                <div className={styles.progressBar}>
                    <div
                        className={styles.progressFill}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* ランダムメッセージ */}
            <div className={styles.tipCard} key={fadeKey}>
                <span className={styles.tipEmoji}>{currentMessage.emoji}</span>
                <p className={styles.tipText}>{currentMessage.text}</p>
            </div>

            <p className={styles.hint}>
                AIが重要な意思決定と、次のアクションを精緻に抽出しています。
            </p>
        </div>
    );
}
