"use client";

import styles from "./RecordButton.module.css";

interface RecordButtonProps {
    isRecording: boolean;
    isPaused: boolean;
    isInterrupted: boolean;
    duration: number;
    onStart: () => void;
    onStop: () => void;
    onPause: () => void;
    onResume: () => void;
    onResumeInterrupted: () => void;
    onCancel?: () => void;
}

export default function RecordButton({
    isRecording,
    isPaused,
    isInterrupted,
    duration,
    onStart,
    onStop,
    onPause,
    onResume,
    onResumeInterrupted,
    onCancel,
}: RecordButtonProps) {
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

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
            <div className={`${styles.recordingIndicator} ${isPaused ? styles.paused : ""} ${isInterrupted ? styles.interrupted : ""}`}>
                <div className={styles.pulsingDot} />
                <span className={styles.timer}>{formatTime(duration)}</span>
                <span className={styles.status}>
                    {isInterrupted ? "！録音中断：マイクが無効です" : isPaused ? "一時停止中" : "録音中..."}
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

            {onCancel && (
                <button className={styles.cancelButton} onClick={onCancel}>
                    ✕ キャンセルしてトップへ戻る
                </button>
            )}
        </div>
    );
}
