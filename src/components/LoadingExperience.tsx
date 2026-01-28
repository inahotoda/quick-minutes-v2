"use client";

import { useState, useEffect } from "react";
import styles from "./LoadingExperience.module.css";

// 思索を促す言葉
const CONTEMPLATIVE_MESSAGES = [
    { text: "ゆっくり首を左右に傾けて、肩の力を抜いてみてください", category: "refresh" },
    { text: "4秒吸って、7秒止めて、8秒で吐く。深呼吸で心を整えましょう", category: "refresh" },
    { text: "20秒間、遠くを見つめると目の疲れが和らぎます", category: "refresh" },
    { text: "水を一口。脳の80%は水分でできています", category: "refresh" },
    { text: "AIは代替ではなく、あなたの創造性を拡張するパートナー", category: "ai" },
    { text: "定型業務から解放されたとき、何をしたいですか？", category: "ai" },
    { text: "この2分間で、年間50時間の手作業が節約されています", category: "ai" },
    { text: "言語の壁を超えて、世界中のチームと協働できる時代", category: "ai" },
];

interface LoadingExperienceProps {
    isVisible: boolean;
}

export default function LoadingExperience({ isVisible }: LoadingExperienceProps) {
    const [currentMessage, setCurrentMessage] = useState("");
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);

    useEffect(() => {
        if (!isVisible) {
            setElapsedSeconds(0);
            return;
        }

        const pickRandom = () => {
            return CONTEMPLATIVE_MESSAGES[Math.floor(Math.random() * CONTEMPLATIVE_MESSAGES.length)].text;
        };

        setCurrentMessage(pickRandom());

        const timer = setInterval(() => {
            setElapsedSeconds((prev) => prev + 1);
        }, 1000);

        const messageTimer = setInterval(() => {
            setIsTransitioning(true);
            setTimeout(() => {
                setCurrentMessage(pickRandom());
                setIsTransitioning(false);
            }, 800);
        }, 12000);

        return () => {
            clearInterval(timer);
            clearInterval(messageTimer);
        };
    }, [isVisible]);

    if (!isVisible) return null;

    const progressPercent = Math.min((elapsedSeconds / 120) * 100, 100);

    return (
        <div className={styles.container}>
            {/* Aurora Background */}
            <div className={styles.auroraContainer}>
                <div className={styles.aurora1}></div>
                <div className={styles.aurora2}></div>
                <div className={styles.aurora3}></div>
            </div>

            {/* Content */}
            <div className={styles.content}>
                {/* Gemini Orb */}
                <div className={styles.orbContainer}>
                    <div className={styles.orb}>
                        <div className={styles.orbInner}></div>
                    </div>
                </div>

                {/* Status */}
                <p className={styles.status}>Gemini が思考しています</p>

                {/* Progress */}
                <div className={styles.progressContainer}>
                    <div className={styles.progressTrack}>
                        <div
                            className={styles.progressFill}
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                </div>

                {/* Contemplative Message */}
                <p className={`${styles.message} ${isTransitioning ? styles.fadeOut : styles.fadeIn}`}>
                    {currentMessage}
                </p>
            </div>
        </div>
    );
}
