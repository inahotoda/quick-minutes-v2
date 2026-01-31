"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
    Member,
    getAllMembers,
    addMember,
    updateMember,
    deleteMember,
} from "@/lib/member-storage";
import styles from "./MemberManager.module.css";

interface MemberManagerProps {
    onMembersChange?: (members: Member[]) => void;
}

export default function MemberManager({ onMembersChange }: MemberManagerProps) {
    const [members, setMembers] = useState<Member[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingMember, setEditingMember] = useState<Member | null>(null);
    const [loading, setLoading] = useState(true);

    // Form state
    const [name, setName] = useState("");
    const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
    const [voiceDuration, setVoiceDuration] = useState(0);
    const [isRecording, setIsRecording] = useState(false);
    const [isManualInput, setIsManualInput] = useState(false); // 手動入力フラグ
    const [recordingTimeLeft, setRecordingTimeLeft] = useState(10); // 10秒カウントダウン
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingStartRef = useRef<number>(0);
    const chunksRef = useRef<Blob[]>([]);
    const recognitionRef = useRef<any>(null);
    const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Load members
    const loadMembers = useCallback(async () => {
        try {
            const data = await getAllMembers();
            setMembers(data);
            onMembersChange?.(data);
        } catch (error) {
            console.error("Failed to load members:", error);
        } finally {
            setLoading(false);
        }
    }, [onMembersChange]);

    useEffect(() => {
        loadMembers();
    }, [loadMembers]);

    // Open add modal
    const handleOpenAddModal = () => {
        setEditingMember(null);
        setName("");
        setVoiceBlob(null);
        setVoiceDuration(0);
        setIsManualInput(false);
        setRecordingTimeLeft(10);
        setIsModalOpen(true);
    };

    // Open edit modal
    const handleOpenEditModal = (member: Member) => {
        setEditingMember(member);
        setName(member.name);
        setVoiceBlob(member.voiceSample?.blob || null);
        setVoiceDuration(member.voiceSample?.duration || 0);
        setIsModalOpen(true);
    };

    // Close modal
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingMember(null);
        setName("");
        setVoiceBlob(null);
        setVoiceDuration(0);
        setIsManualInput(false);
        setRecordingTimeLeft(10);
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }
        if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
        }
    };

    // Start recording with speech recognition
    const handleStartRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: "audio/webm;codecs=opus",
            });

            chunksRef.current = [];
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = () => {
                // 音声データは認識成功時に保存済み
                setIsRecording(false);
                stream.getTracks().forEach((track) => track.stop());
            };

            mediaRecorderRef.current = mediaRecorder;
            recordingStartRef.current = Date.now();
            mediaRecorder.start();
            setIsRecording(true);
            setRecordingTimeLeft(10); // カウントダウン開始

            // 10秒カウントダウン
            countdownIntervalRef.current = setInterval(() => {
                setRecordingTimeLeft((prev) => {
                    if (prev <= 1) {
                        // 0秒になったら自動停止
                        clearInterval(countdownIntervalRef.current!);
                        countdownIntervalRef.current = null;
                        // 音声データを保存
                        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                        const duration = (Date.now() - recordingStartRef.current) / 1000;
                        setVoiceBlob(blob);
                        setVoiceDuration(duration);
                        // 録音停止
                        if (mediaRecorderRef.current?.state === "recording") {
                            mediaRecorderRef.current.stop();
                        }
                        if (recognitionRef.current) {
                            try { recognitionRef.current.stop(); } catch { }
                        }
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            // Start speech recognition
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.lang = "ja-JP";
                recognition.continuous = false;
                recognition.interimResults = true;

                recognition.onresult = (event: any) => {
                    for (let i = 0; i < event.results.length; i++) {
                        const result = event.results[i];
                        if (result.isFinal) {
                            const text = result[0].transcript;
                            const extractedName = extractName(text);
                            if (extractedName) {
                                setName(extractedName);
                                // 名前認識成功時のみ音声データを保存
                                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                                const duration = (Date.now() - recordingStartRef.current) / 1000;
                                setVoiceBlob(blob);
                                setVoiceDuration(duration);
                            }
                        }
                    }
                };

                recognitionRef.current = recognition;
                recognition.start();
            }
        } catch (error) {
            console.error("Failed to start recording:", error);
            alert("マイクへのアクセスを許可してください");
        }
    };

    // Extract name from speech
    const INTRO_PATTERNS = [
        /(?:私(?:は|の名前は)?|わたし(?:は|の名前は)?|僕(?:は|の名前は)?|ぼく(?:は|の名前は)?)(.+?)(?:です|と申します|といいます)/,
        /(.+?)(?:です|と申します|といいます|っす)$/,
    ];

    const extractName = (text: string): string | null => {
        const cleaned = text.trim().replace(/\s+/g, "");
        for (const pattern of INTRO_PATTERNS) {
            const match = cleaned.match(pattern);
            if (match && match[1]) return match[1];
        }
        return null;
    };

    // Auto-start recording when modal opens (for new member only)
    useEffect(() => {
        if (isModalOpen && !editingMember && !isRecording && !name) {
            const timer = setTimeout(() => {
                handleStartRecording();
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isModalOpen, editingMember]);

    // Stop recording and return blob
    const handleStopRecording = (): Promise<{ blob: Blob; duration: number } | null> => {
        return new Promise((resolve) => {
            if (mediaRecorderRef.current?.state === "recording") {
                mediaRecorderRef.current.addEventListener("stop", () => {
                    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                    const duration = (Date.now() - recordingStartRef.current) / 1000;
                    resolve({ blob, duration });
                }, { once: true });
                mediaRecorderRef.current.stop();
            } else {
                resolve(null);
            }
        });
    };

    // Save member - auto-stop recording if in progress
    const handleSave = async () => {
        if (!name.trim()) return;

        // 手動入力の場合は音声なし
        const useVoice = !isManualInput;
        let finalVoiceBlob = useVoice ? voiceBlob : null;
        let finalDuration = useVoice ? voiceDuration : 0;

        // If still recording and using voice, stop and wait for blob
        if (isRecording && useVoice) {
            const result = await handleStopRecording();
            if (result) {
                finalVoiceBlob = result.blob;
                finalDuration = result.duration;
            }
        } else if (isRecording) {
            // 手動入力時は録音を停止するが音声は使わない
            await handleStopRecording();
            finalVoiceBlob = null;
            finalDuration = 0;
        }

        try {
            if (editingMember) {
                await updateMember(editingMember.id, {
                    name: name.trim(),
                    voiceSample: finalVoiceBlob
                        ? {
                            blob: finalVoiceBlob,
                            duration: finalDuration,
                            recordedAt: new Date().toISOString(),
                        }
                        : undefined,
                });
            } else {
                await addMember(name.trim(), finalVoiceBlob || undefined, finalVoiceBlob ? finalDuration : undefined);
            }

            await loadMembers();
            handleCloseModal();
        } catch (error) {
            console.error("Failed to save member:", error);
            alert("保存に失敗しました");
        }
    };

    // Delete member
    const handleDelete = async (member: Member) => {
        if (!confirm(`「${member.name}」を削除しますか？`)) return;

        try {
            await deleteMember(member.id);
            await loadMembers();
        } catch (error) {
            console.error("Failed to delete member:", error);
            alert("削除に失敗しました");
        }
    };

    // Format duration
    const formatDuration = (seconds: number) => {
        const s = Math.round(seconds);
        return `${s}秒`;
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <p style={{ color: "rgba(255,255,255,0.5)" }}>読み込み中...</p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <h3 className={styles.title}>メンバー一覧</h3>
                <button className={styles.addButton} onClick={handleOpenAddModal}>
                    <span>+</span> メンバー追加
                </button>
            </div>

            {/* Member List */}
            {members.length === 0 ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>👥</div>
                    <p className={styles.emptyText}>
                        メンバーがまだ登録されていません。
                        <br />
                        「メンバー追加」から追加してください。
                    </p>
                </div>
            ) : (
                <div className={styles.memberList}>
                    {members.map((member) => (
                        <div key={member.id} className={styles.memberCard}>
                            <div className={styles.memberAvatar}>👤</div>
                            <div className={styles.memberInfo}>
                                <div className={styles.memberName}>{member.name}</div>
                                <div className={styles.memberMeta}>
                                    {member.voiceSample ? (
                                        <span className={`${styles.voiceStatus} ${styles.voiceStatusRecorded}`}>
                                            ✓ 音声登録済み ({formatDuration(member.voiceSample.duration)})
                                        </span>
                                    ) : (
                                        <span className={`${styles.voiceStatus} ${styles.voiceStatusNone}`}>
                                            音声未登録
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className={styles.memberActions}>
                                <button
                                    className={styles.actionButton}
                                    onClick={() => handleOpenEditModal(member)}
                                    title="編集"
                                >
                                    ✏️
                                </button>
                                <button
                                    className={`${styles.actionButton} ${styles.deleteButton}`}
                                    onClick={() => handleDelete(member)}
                                    title="削除"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal */}
            {isModalOpen && (
                <div className={styles.modalOverlay} onClick={handleCloseModal}>
                    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                        <h2 className={styles.modalTitle}>
                            {editingMember ? "メンバー編集" : "新しいメンバー"}
                        </h2>

                        {/* Name Input with Voice Recognition */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>名前</label>
                            <div className={styles.inputRow}>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        // 手動入力時は音声データをクリア
                                        setVoiceBlob(null);
                                        setVoiceDuration(0);
                                        setIsManualInput(true);
                                    }}
                                    placeholder="名前のみ登録の場合は入力可"
                                    autoFocus={!isRecording}
                                />
                                <div
                                    className={`${styles.micIndicator} ${isRecording ? styles.micIndicatorActive : ''}`}
                                    title={isRecording ? "音声認識中..." : "音声認識待機中"}
                                >
                                    <span className={styles.micIcon} />
                                </div>
                            </div>
                            {isRecording && (
                                <div className={`${styles.recordingStatus} ${recordingTimeLeft <= 3 ? styles.recordingWarning : ''}`}>
                                    <span className={styles.recordingDot} />
                                    <span className={styles.countdownTimer}>{recordingTimeLeft}秒</span>
                                    <span className={styles.recordingText}>
                                        {name ? `認識: ${name}` : "「〇〇です」とお名前を..."}
                                    </span>
                                </div>
                            )}
                            {!isRecording && recordingTimeLeft === 0 && !voiceBlob && (
                                <div className={styles.recordingComplete}>
                                    ⏱️ 10秒経過 - 名前を入力してください
                                </div>
                            )}
                        </div>

                        {/* Voice status */}
                        {voiceBlob && (
                            <div className={styles.voicePreviewCompact}>
                                <span className={styles.voicePreviewIcon}>🎵</span>
                                <span className={styles.voicePreviewText}>
                                    音声登録済み ({formatDuration(voiceDuration)})
                                </span>
                                <button
                                    className={styles.playButton}
                                    onClick={() => {
                                        const audio = new Audio(URL.createObjectURL(voiceBlob));
                                        audio.play();
                                    }}
                                    title="音声を確認"
                                >
                                    ▶️
                                </button>
                                <button
                                    className={styles.clearVoiceButton}
                                    onClick={() => {
                                        setVoiceBlob(null);
                                        setVoiceDuration(0);
                                    }}
                                    title="音声をクリア"
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                        {/* Actions */}
                        <div className={styles.modalActions}>
                            <button className={styles.cancelButton} onClick={handleCloseModal}>
                                キャンセル
                            </button>
                            <button
                                className={styles.saveButton}
                                onClick={handleSave}
                                disabled={!name.trim()}
                            >
                                {editingMember ? "更新" : "追加"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
