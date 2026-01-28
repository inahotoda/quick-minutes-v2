"use client";

import { useState, useEffect } from "react";
import styles from "./ProcessingScreen.module.css";

const MESSAGES = [
    "ゆっくり深呼吸してみましょう。4秒吸って、4秒止めて、4秒で吐く。",
    "遠くを見つめて目を休ませましょう。20秒で疲れが和らぎます。",
    "水分補給のチャンスです。脳の80%は水分でできています。",
    "肩をゆっくり回してストレッチ。血行が良くなりますよ。",
    "AIは仕事を奪うのではなく、あなたの創造性を拡張するパートナーです。",
    "議事録の自動化で、年間約50時間を創造的な仕事に使えます。",
    "AIリアルタイム翻訳で、言語の壁なく世界中と協働できる時代に。",
    "定型業務はAIに任せ、人間は意思決定と関係構築に集中しましょう。",
    "会議の価値は「決定」と「次のアクション」。AIがそれを逃しません。",
    "少し席を立って、コーヒーや紅茶を淹れてきませんか？",
];

export default function ProcessingScreen() {
    const [currentMessage, setCurrentMessage] = useState(MESSAGES[0]);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [fadeKey, setFadeKey] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setElapsedSeconds((prev) => prev + 1);
        }, 1000);

        const messageTimer = setInterval(() => {
            setFadeKey((prev) => prev + 1);
            const randomIndex = Math.floor(Math.random() * MESSAGES.length);
            setCurrentMessage(MESSAGES[randomIndex]);
        }, 12000);

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
            {/* Futuristic Orb with Rings and Particles */}
            <div className={styles.orbContainer}>
                <div className={`${styles.ring} ${styles.ring3}`} />
                <div className={`${styles.ring} ${styles.ring1}`} />
                <div className={`${styles.ring} ${styles.ring2}`} />
                <div className={`${styles.particle} ${styles.particle1}`} />
                <div className={`${styles.particle} ${styles.particle2}`} />
                <div className={styles.orb}>
                    <div className={styles.orbCore} />
                </div>
            </div>

            <h2 className={styles.title}>会議、お疲れ様でした</h2>
            <p className={styles.subtitle}>価値ある対話を、確かな資産に変えています</p>

            {/* Timer */}
            <div className={styles.timerSection}>
                <div className={styles.countdown}>
                    {minutes}:{seconds.toString().padStart(2, "0")}
                </div>
                <div className={styles.progressTrack}>
                    <div
                        className={styles.progressFill}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* Message */}
            <p className={styles.message} key={fadeKey}>
                {currentMessage}
            </p>
        </div>
    );
}
