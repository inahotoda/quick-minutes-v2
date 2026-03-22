"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./RecordButton.module.css";

interface RecordButtonProps {
    isRecording: boolean;
    isPaused: boolean;
    isInterrupted: boolean;
    duration: number;
    countdownFrom?: number; // 秒単位（例: 30分 = 1800）
    onStart: () => void;
    onStop: () => void;
    onPause: () => void;
    onResume: () => void;
    onResumeInterrupted: () => void;
    onCancel?: () => void;
    onTimeUp?: () => void;
    additionalPrompt?: string;
    onAdditionalPromptChange?: (value: string) => void;
}

export default function RecordButton({
    isRecording,
    isPaused,
    isInterrupted,
    duration,
    countdownFrom,
    onStart,
    onStop,
    onPause,
    onResume,
    onResumeInterrupted,
    onCancel,
    onTimeUp,
    additionalPrompt = "",
    onAdditionalPromptChange,
}: RecordButtonProps) {
    const [isPromptOpen, setIsPromptOpen] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);
    const lastBeepTimeRef = useRef<number | null>(null);
    const alarmPlayedRef = useRef<boolean>(false);

    // ビープ音を鳴らす
    const playBeep = useCallback((frequency: number = 800, duration: number = 100) => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            const ctx = audioContextRef.current;
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);

            oscillator.frequency.value = frequency;
            oscillator.type = "sine";
            gainNode.gain.value = 0.3;

            oscillator.start();
            oscillator.stop(ctx.currentTime + duration / 1000);
        } catch (error) {
            console.error("Failed to play beep:", error);
        }
    }, []);

    // アラーム音（連続ビープ）
    const playAlarm = useCallback(() => {
        for (let i = 0; i < 6; i++) {
            setTimeout(() => playBeep(1000, 80), i * 120);
        }
    }, [playBeep]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(Math.abs(seconds) / 60);
        const secs = Math.abs(seconds) % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    // カウントダウン計算
    const remainingTime = countdownFrom ? countdownFrom - duration : null;
    const isCountdown = remainingTime !== null;
    const isTimeUp = isCountdown && remainingTime <= 0 && !isPaused;
    const isWarning = isCountdown && remainingTime > 0 && remainingTime <= 60; // 残り1分
    const isUrgent = isCountdown && remainingTime > 0 && remainingTime <= 30; // 残り30秒
    const shouldBeep = isCountdown && remainingTime !== null && remainingTime > 0 && remainingTime <= 20 && !isPaused; // 残り20秒

    // ビープ音の制御
    useEffect(() => {
        if (shouldBeep && remainingTime !== null) {
            // 1秒ごとにビープ（同じ秒で複数回鳴らないようにする）
            if (lastBeepTimeRef.current !== remainingTime) {
                lastBeepTimeRef.current = remainingTime;
                // 残り10秒以下は高い音
                const freq = remainingTime <= 10 ? 1000 : 800;
                playBeep(freq, 100);
            }
        }
    }, [shouldBeep, remainingTime, playBeep]);

    // アラーム音の制御（0秒になった時）
    useEffect(() => {
        if (isTimeUp && !alarmPlayedRef.current) {
            alarmPlayedRef.current = true;
            playAlarm();
        }
        // リセット
        if (!isTimeUp && alarmPlayedRef.current) {
            alarmPlayedRef.current = false;
        }
    }, [isTimeUp, playAlarm]);

    // 録音開始時にアラームフラグをリセット
    useEffect(() => {
        if (!isRecording) {
            alarmPlayedRef.current = false;
            lastBeepTimeRef.current = null;
        }
    }, [isRecording]);

    // 時間切れ通知
    if (isTimeUp && onTimeUp) {
        // 次のレンダーサイクルで呼び出し
        setTimeout(() => onTimeUp(), 0);
    }

    if (!isRecording) {
        return (
            <button className={styles.recordButton} onClick={onStart}>
                <div className={styles.micIcon}>
                    <svg viewBox="0 0 24 24" fill="currentColor" width="100%" height="100%">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                    </svg>
                </div>
                <span className={styles.label}>タップして録音開始</span>
            </button>
        );
    }

    return (
        <div className={styles.recordingContainer}>
            <div className={`${styles.recordingIndicator} ${isPaused ? styles.paused : ""} ${isInterrupted ? styles.interrupted : ""} ${isWarning ? styles.warning : ""} ${isUrgent ? styles.urgent : ""}`}>
                <div className={styles.pulsingDot} />
                <span className={`${styles.timer} ${isUrgent ? styles.timerUrgent : ""}`}>
                    {isCountdown ? (
                        remainingTime! > 0 ? formatTime(remainingTime!) : "00:00"
                    ) : (
                        formatTime(duration)
                    )}
                </span>
                <span className={styles.status}>
                    {isInterrupted ? "！録音中断：マイクが無効です" :
                        isPaused ? "一時停止中" :
                            isUrgent ? "⚠️ まもなく終了" :
                                isWarning ? "残り1分" :
                                    isCountdown ? "録音中" : "録音中..."}
                </span>
            </div>

            <div className={styles.controls}>
                {isInterrupted ? (
                    <button className={styles.resumeInterruptedButton} onClick={onResumeInterrupted}>
                        🔄 録音を再開
                    </button>
                ) : isPaused ? (
                    <button className={styles.controlButton} onClick={onResume}>
                        ▶️ 再開
                    </button>
                ) : (
                    <button className={styles.controlButton} onClick={onPause}>
                        ⏸️ 一時停止
                    </button>
                )}
                <button className={styles.stopButton} onClick={onStop}>
                    ⏹️ 停止して生成
                </button>
            </div>

            {/* 追加指示入力 */}
            <div className={styles.additionalPromptSection}>
                <button
                    className={`${styles.promptToggle} ${isPromptOpen ? styles.promptToggleOpen : ''}`}
                    onClick={() => setIsPromptOpen(!isPromptOpen)}
                >
                    <span>📝 追加の指示</span>
                    <span className={styles.promptToggleArrow}>{isPromptOpen ? '▲' : '▼'}</span>
                </button>
                {isPromptOpen && (
                    <textarea
                        className={styles.promptInput}
                        value={additionalPrompt}
                        onChange={(e) => onAdditionalPromptChange?.(e.target.value)}
                        placeholder="例: 日本語と英語の併記にして / タスクを全て拾って"
                        rows={3}
                    />
                )}
            </div>

            {onCancel && (
                <button className={styles.cancelButton} onClick={onCancel}>
                    ✕ キャンセルしてトップへ戻る
                </button>
            )}
        </div>
    );
}

