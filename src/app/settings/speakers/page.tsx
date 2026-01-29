"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "../settings.module.css";

interface SpeakerProfile {
    profileId: string;
    name: string;
    enrollmentStatus: string;
    createdAt: string;
}

export default function SpeakersSettingsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // 話者登録
    const [speakers, setSpeakers] = useState<SpeakerProfile[]>([]);
    const [newSpeakerName, setNewSpeakerName] = useState("");
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [enrolling, setEnrolling] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        async function fetchSpeakers() {
            try {
                const res = await fetch("/api/speaker/profiles");
                if (res.ok) {
                    const data = await res.json();
                    setSpeakers(data.profiles || []);
                }
            } catch (err) {
                console.error("Failed to fetch speakers:", err);
            } finally {
                setLoading(false);
            }
        }
        fetchSpeakers();
    }, []);

    // 録音開始
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            mediaRecorder.start(1000);
            setIsRecording(true);
            setRecordingTime(0);

            timerRef.current = setInterval(() => {
                setRecordingTime((prev) => prev + 1);
            }, 1000);
        } catch (err) {
            console.error("Failed to start recording:", err);
            setMessage({ type: "error", text: "マイクへのアクセスに失敗しました" });
        }
    };

    // 録音停止 & 登録
    const stopAndEnroll = async () => {
        if (!mediaRecorderRef.current) return;

        setIsRecording(false);
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());

        await new Promise((resolve) => setTimeout(resolve, 500));

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });

        if (!newSpeakerName.trim()) {
            setMessage({ type: "error", text: "名前を入力してください" });
            return;
        }

        if (recordingTime < 10) {
            setMessage({ type: "error", text: "10秒以上録音してください" });
            return;
        }

        setEnrolling(true);
        try {
            const formData = new FormData();
            formData.append("action", "enroll");
            formData.append("name", newSpeakerName);
            formData.append("audio", audioBlob, "enrollment.webm");

            const res = await fetch("/api/speaker", {
                method: "POST",
                body: formData,
            });

            if (res.ok) {
                const data = await res.json();
                setSpeakers((prev) => [
                    ...prev,
                    {
                        profileId: data.profileId,
                        name: newSpeakerName,
                        enrollmentStatus: data.enrollmentStatus,
                        createdAt: new Date().toISOString(),
                    },
                ]);
                setNewSpeakerName("");
                setMessage({ type: "success", text: `${newSpeakerName}さんを登録しました` });
            } else {
                const err = await res.json();
                throw new Error(err.error || "登録に失敗しました");
            }
        } catch (err: any) {
            setMessage({ type: "error", text: err.message });
        } finally {
            setEnrolling(false);
        }
    };

    // 話者削除
    const handleDeleteSpeaker = async (profileId: string, name: string) => {
        if (!confirm(`${name}さんの登録を削除しますか？`)) return;

        try {
            const res = await fetch(`/api/speaker?profileId=${profileId}`, {
                method: "DELETE",
            });

            if (res.ok) {
                setSpeakers((prev) => prev.filter((s) => s.profileId !== profileId));
                setMessage({ type: "success", text: `${name}さんを削除しました` });
            } else {
                throw new Error("削除に失敗しました");
            }
        } catch (err: any) {
            setMessage({ type: "error", text: err.message });
        }
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>読み込み中...</p>
            </div>
        );
    }

    return (
        <div className={styles.main}>
            <header className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push("/settings")}>
                    ← 設定に戻る
                </button>
                <h1 className={styles.title}>🎤 話者登録</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.content}>
                {message && (
                    <div className={`${styles.alert} ${styles[message.type]}`}>
                        {message.type === "success" ? "✅" : "⚠️"} {message.text}
                    </div>
                )}

                <section className={styles.section}>
                    <h2>Voice Enrollment</h2>
                    <p className={styles.help}>
                        メンバーの声を事前登録すると、議事録で話者を自動識別できます。<br />
                        <strong>20秒以上</strong>の自由な発話を録音してください。
                    </p>

                    {/* 登録済み話者一覧 */}
                    {speakers.length > 0 && (
                        <div className={styles.speakerList}>
                            <h3>登録済みメンバー</h3>
                            {speakers.map((speaker) => (
                                <div key={speaker.profileId} className={styles.speakerItem}>
                                    <span className={styles.speakerName}>👤 {speaker.name}</span>
                                    <span className={styles.speakerStatus}>
                                        {speaker.enrollmentStatus === "enrolled" ? "✅ 登録完了" : "⏳ 処理中"}
                                    </span>
                                    <button
                                        className={styles.deleteButton}
                                        onClick={() => handleDeleteSpeaker(speaker.profileId, speaker.name)}
                                    >
                                        削除
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {speakers.length === 0 && (
                        <div className={styles.emptyState}>
                            <p>まだ登録されていません</p>
                        </div>
                    )}

                    {/* 新規登録 */}
                    <div className={styles.enrollmentForm}>
                        <input
                            type="text"
                            value={newSpeakerName}
                            onChange={(e) => setNewSpeakerName(e.target.value)}
                            placeholder="登録する人の名前 (例: 田中太郎)"
                            className={styles.nameInput}
                            disabled={isRecording || enrolling}
                        />

                        {!isRecording ? (
                            <button
                                className={styles.recordButton}
                                onClick={startRecording}
                                disabled={!newSpeakerName.trim() || enrolling}
                            >
                                🎙️ 録音開始
                            </button>
                        ) : (
                            <div className={styles.recordingStatus}>
                                <span className={styles.recordingIndicator}>🔴 録音中: {recordingTime}秒</span>
                                <button
                                    className={styles.stopButton}
                                    onClick={stopAndEnroll}
                                    disabled={recordingTime < 10 || enrolling}
                                >
                                    {enrolling ? "登録中..." : recordingTime < 10 ? `あと${10 - recordingTime}秒` : "⏹️ 停止して登録"}
                                </button>
                            </div>
                        )}
                    </div>

                    <p className={styles.note}>
                        ※ Azure Speaker Recognition APIを使用しています。<br />
                        ※ 声紋データはAzureに保存され、元の音声ファイルは保存されません。<br />
                        ※ 現在、Azure側のAPI設定が必要です。環境変数が未設定の場合、登録は失敗します。
                    </p>
                </section>
            </div>
        </div>
    );
}
