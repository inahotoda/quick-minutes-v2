"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import styles from "./settings.module.css";

interface PromptConfig {
    basePrompt: string;
    internalPrompt: string;
    businessPrompt: string;
    otherPrompt: string;
    terminology: string;
    updatedBy?: string;
    updatedAt?: string;
    history?: any[];
}

interface SpeakerProfile {
    profileId: string;
    name: string;
    enrollmentStatus: string;
    createdAt: string;
}

export default function SettingsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // プロンプト設定
    const [settings, setSettings] = useState<PromptConfig>({
        basePrompt: "",
        internalPrompt: "",
        businessPrompt: "",
        otherPrompt: "",
        terminology: "",
    });

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
        async function fetchData() {
            try {
                // プロンプト設定を取得
                const promptsRes = await fetch("/api/prompts");
                if (promptsRes.ok) {
                    const data = await promptsRes.json();
                    setSettings(data);
                }

                // 話者プロファイル一覧を取得
                const speakersRes = await fetch("/api/speaker/profiles");
                if (speakersRes.ok) {
                    const data = await speakersRes.json();
                    setSpeakers(data.profiles || []);
                }
            } catch (err) {
                console.error("Failed to fetch data:", err);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
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

        // 少し待ってからBlobを作成
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

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            // 履歴データは除外して送信
            const { history: _, updatedBy: __, updatedAt: ___, ...dataToSave } = settings;
            const res = await fetch("/api/prompts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(dataToSave),
            });
            if (res.ok) {
                const newData = await res.json();
                setSettings(newData.config);
                setMessage({ type: "success", text: "設定を保存しました" });
                window.scrollTo({ top: 0, behavior: "smooth" });
                setTimeout(() => setMessage(null), 3000);
            } else {
                throw new Error("Save failed");
            }
        } catch (err) {
            setMessage({ type: "error", text: "保存に失敗しました" });
        } finally {
            setSaving(false);
        }
    };

    const handleRestore = (oldVersion: any) => {
        if (confirm("このバージョンの内容を表示しますか？（現在の編集内容は上書きされます）")) {
            setSettings({
                ...settings,
                basePrompt: oldVersion.basePrompt,
                internalPrompt: oldVersion.internalPrompt,
                businessPrompt: oldVersion.businessPrompt,
                otherPrompt: oldVersion.otherPrompt,
                terminology: oldVersion.terminology,
            });
            window.scrollTo({ top: 0, behavior: "smooth" });
            setMessage({ type: "success", text: "履歴から復元しました（「保存」するまで確定されません）" });
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
                <button className={styles.backButton} onClick={() => router.push("/")}>
                    ← 戻る
                </button>
                <h1 className={styles.title}>⚙️ カスタムプロンプト設定</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.content}>
                {message && (
                    <div className={`${styles.alert} ${styles[message.type]}`}>
                        {message.type === "success" ? "✅" : "⚠️"} {message.text}
                    </div>
                )}

                {settings.updatedBy && (
                    <div className={styles.lastUpdate}>
                        最終更新: {new Date(settings.updatedAt!).toLocaleString("ja-JP")} ({settings.updatedBy})
                    </div>
                )}

                <section className={styles.section}>
                    <h2>基本プロンプト</h2>
                    <p className={styles.help}>議事録の全体的な構成やトーンを指定します。</p>
                    <textarea
                        value={settings.basePrompt}
                        onChange={(e) => setSettings({ ...settings, basePrompt: e.target.value })}
                        placeholder="あなたは優秀な議事録作成アシスタントです。..."
                        rows={8}
                    />
                </section>

                <section className={styles.section}>
                    <h2>社内MTGモード</h2>
                    <p className={styles.help}>「社内」モード選択時に追加される指示です。</p>
                    <textarea
                        value={settings.internalPrompt}
                        onChange={(e) => setSettings({ ...settings, internalPrompt: e.target.value })}
                        placeholder="決定事項とアクションアイテムを優先的に抽出してください。..."
                        rows={5}
                    />
                </section>

                <section className={styles.section}>
                    <h2>商談モード</h2>
                    <p className={styles.help}>「商談」モード選択時に追加される指示です。</p>
                    <textarea
                        value={settings.businessPrompt}
                        onChange={(e) => setSettings({ ...settings, businessPrompt: e.target.value })}
                        placeholder="顧客の課題、提案への反応、ネクストアクションを整理してください。..."
                        rows={5}
                    />
                </section>

                <section className={styles.section}>
                    <h2>専門用語・固有名詞</h2>
                    <p className={styles.help}>誤字変換を防ぎたい会社名や専門用語を登録します。</p>
                    <textarea
                        value={settings.terminology}
                        onChange={(e) => setSettings({ ...settings, terminology: e.target.value })}
                        placeholder="INAHO, 生成AI, プロンプトエンジニアリング, ..."
                        rows={5}
                    />
                </section>

                <section className={styles.section}>
                    <h2>🎤 話者登録（Voice Enrollment）</h2>
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
                        ※ 声紋データはAzureに保存され、元の音声ファイルは保存されません。
                    </p>
                </section>

                <div className={styles.actions}>
                    <button
                        className={styles.saveButton}
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? "保存中..." : "設定を保存する"}
                    </button>
                </div>

                {settings.history && settings.history.length > 0 && (
                    <section className={styles.historySection}>
                        <hr className={styles.divider} />
                        <h3>🕒 変更履歴（過去10件）</h3>
                        <div className={styles.historyList}>
                            {settings.history.map((item, index) => (
                                <div key={index} className={styles.historyItem}>
                                    <div className={styles.historyInfo}>
                                        <span className={styles.historyDate}>
                                            {new Date(item.updatedAt).toLocaleString("ja-JP")}
                                        </span>
                                        <span className={styles.historyUser}>{item.updatedBy}</span>
                                    </div>
                                    <button
                                        className={styles.restoreButton}
                                        onClick={() => handleRestore(item)}
                                    >
                                        復元
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
