"use client";

import { useState, useEffect } from "react";
import styles from "./TimerEndModal.module.css";

interface TimerEndModalProps {
    onEnd: () => void;
    onExtend: (duration: number) => void;
    onExtendWithBreak: (duration: number) => void;
}

const EXTEND_OPTIONS: { value: number; label: string }[] = [
    { value: 15, label: "15分" },
    { value: 30, label: "30分" },
    { value: 45, label: "45分" },
];

const BREAK_DURATION = 10 * 60; // 10分

export default function TimerEndModal({
    onEnd,
    onExtend,
    onExtendWithBreak,
}: TimerEndModalProps) {
    const [showExtendOptions, setShowExtendOptions] = useState<"direct" | "break" | null>(null);
    const [breakCountdown, setBreakCountdown] = useState<number | null>(null);
    const [selectedExtendDuration, setSelectedExtendDuration] = useState<number | null>(null);

    // 休憩カウントダウン
    useEffect(() => {
        if (breakCountdown === null) return;
        if (breakCountdown <= 0) {
            if (selectedExtendDuration) {
                onExtendWithBreak(selectedExtendDuration);
            }
            return;
        }
        const timer = setTimeout(() => setBreakCountdown(breakCountdown - 1), 1000);
        return () => clearTimeout(timer);
    }, [breakCountdown, selectedExtendDuration, onExtendWithBreak]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const handleDirectExtend = (duration: number) => {
        if (confirm("⚠️ 休憩なしで延長しますか？\n\n長時間の会議は集中力が低下する可能性があります。")) {
            onExtend(duration);
        }
    };

    const handleBreakExtend = (duration: number) => {
        setSelectedExtendDuration(duration);
        setBreakCountdown(BREAK_DURATION);
    };

    // 休憩画面
    if (breakCountdown !== null) {
        return (
            <div className={styles.overlay}>
                <div className={styles.modal}>
                    <div className={styles.breakHeader}>
                        <span className={styles.breakIcon}>☕</span>
                        <h2 className={styles.breakTitle}>休憩中</h2>
                    </div>
                    <div className={styles.breakCountdown}>{formatTime(breakCountdown)}</div>
                    <p className={styles.breakMessage}>
                        リフレッシュして、より良い会議にしましょう！
                    </p>
                    <button
                        className={styles.skipBreakButton}
                        onClick={() => {
                            if (selectedExtendDuration) {
                                onExtendWithBreak(selectedExtendDuration);
                            }
                        }}
                    >
                        休憩をスキップ
                    </button>
                </div>
            </div>
        );
    }

    // 延長時間選択画面
    if (showExtendOptions) {
        return (
            <div className={styles.overlay}>
                <div className={styles.modal}>
                    <h2 className={styles.title}>
                        {showExtendOptions === "break" ? "☕ 休憩して延長" : "⚠️ そのまま延長"}
                    </h2>
                    <p className={styles.subtitle}>延長時間を選択してください</p>
                    <div className={styles.extendOptions}>
                        {EXTEND_OPTIONS.map(({ value, label }) => (
                            <button
                                key={value}
                                className={styles.extendButton}
                                onClick={() =>
                                    showExtendOptions === "break"
                                        ? handleBreakExtend(value)
                                        : handleDirectExtend(value)
                                }
                            >
                                +{label}
                            </button>
                        ))}
                    </div>
                    <button
                        className={styles.backButton}
                        onClick={() => setShowExtendOptions(null)}
                    >
                        ← 戻る
                    </button>
                </div>
            </div>
        );
    }

    // メイン選択画面
    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.timeUpHeader}>
                    <span className={styles.timeUpIcon}>⏰</span>
                    <h2 className={styles.title}>時間です！</h2>
                </div>
                <p className={styles.subtitle}>会議をどうしますか？</p>
                <div className={styles.options}>
                    <button className={styles.endButton} onClick={onEnd}>
                        ✓ 会議終了
                    </button>
                    <button
                        className={styles.breakButton}
                        onClick={() => setShowExtendOptions("break")}
                    >
                        ☕ 休憩(10分)して延長
                    </button>
                    <button
                        className={styles.directButton}
                        onClick={() => setShowExtendOptions("direct")}
                    >
                        ⚠️ そのまま延長
                    </button>
                </div>
            </div>
        </div>
    );
}
