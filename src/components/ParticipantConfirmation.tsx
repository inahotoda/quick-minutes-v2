"use client";

import { useState, useEffect, useRef } from "react";
import { Member, MeetingPreset, getAllMembers, addMember } from "@/lib/member-storage";
import styles from "./ParticipantConfirmation.module.css";

export interface ConfirmedParticipant {
    id: string;
    name: string;
    hasVoice: boolean;
    voiceBlob?: Blob;
}

interface ParticipantConfirmationProps {
    preset?: MeetingPreset | null;
    onConfirm: (participants: ConfirmedParticipant[]) => void;
    onCancel: () => void;
    // For floating modal mode during recording
    isFloating?: boolean;
    currentParticipants?: ConfirmedParticipant[];
    onUpdate?: (participants: ConfirmedParticipant[]) => void;
    onClose?: () => void;
    // For upload mode (show "議事録生成" instead of "Mtgスタート")
    isUploadMode?: boolean;
}

export default function ParticipantConfirmation({
    preset,
    onConfirm,
    onCancel,
    isFloating = false,
    currentParticipants = [],
    onUpdate,
    onClose,
    isUploadMode = false,
}: ParticipantConfirmationProps) {
    const [members, setMembers] = useState<Member[]>([]);
    const [participants, setParticipants] = useState<ConfirmedParticipant[]>([]);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [newName, setNewName] = useState("");
    const [newVoiceBlob, setNewVoiceBlob] = useState<Blob | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [loading, setLoading] = useState(true);
    const [recognizedName, setRecognizedName] = useState<string | null>(null);
    const [isManualInput, setIsManualInput] = useState(false); // 手動入力フラグ
    const [recordingTimeLeft, setRecordingTimeLeft] = useState(10); // 10秒カウントダウン

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingStartRef = useRef<number>(0);
    const recognitionRef = useRef<any>(null);
    const chunksRef = useRef<Blob[]>([]);
    const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Name extraction patterns
    const INTRO_PATTERNS = [
        /^(.{1,10})です[。、]?$/,
        /^(.{1,10})と申します/,
        /^私[はが、](.{1,10})です/,
        /^(.{1,10})といいます/,
        /^(.{1,10})と言います/,
    ];

    const extractName = (text: string): string | null => {
        const cleaned = text.trim().replace(/\s+/g, "");
        for (const pattern of INTRO_PATTERNS) {
            const match = cleaned.match(pattern);
            if (match && match[1]) return match[1];
        }
        return null;
    };

    // Load members and initialize participants
    useEffect(() => {
        const load = async () => {
            try {
                const allMembers = await getAllMembers();
                setMembers(allMembers);

                if (isFloating && currentParticipants.length > 0) {
                    setParticipants(currentParticipants);
                } else if (preset) {
                    // Initialize from preset
                    const presetParticipants = preset.memberIds
                        .map((id) => {
                            const member = allMembers.find((m) => m.id === id);
                            if (!member) return null;
                            return {
                                id: member.id,
                                name: member.name,
                                hasVoice: !!member.voiceSample,
                                voiceBlob: member.voiceSample?.blob,
                            };
                        })
                        .filter(Boolean) as ConfirmedParticipant[];
                    setParticipants(presetParticipants);
                }
            } catch (error) {
                console.error("Failed to load members:", error);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [preset, isFloating, currentParticipants]);

    // Remove participant
    const handleRemove = (id: string) => {
        setParticipants((prev) => prev.filter((p) => p.id !== id));
    };

    // Add existing member
    const handleAddExisting = (member: Member) => {
        if (participants.some((p) => p.id === member.id)) return;
        setParticipants((prev) => [
            ...prev,
            {
                id: member.id,
                name: member.name,
                hasVoice: !!member.voiceSample,
                voiceBlob: member.voiceSample?.blob,
            },
        ]);
    };

    // Auto-start recording when adding new participant
    useEffect(() => {
        if (isAddingNew && !isRecording && !newName) {
            // Small delay to allow UI to render first
            const timer = setTimeout(() => {
                handleStartRecordingInternal();
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isAddingNew]);

    // Internal recording start (extracted for auto-start)
    const handleStartRecordingInternal = async () => {
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
                // 音声データは認識成功時に保存済み（または認識失敗なら保存しない）
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
                        setNewVoiceBlob(blob);
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
                            const name = extractName(text);
                            if (name) {
                                setRecognizedName(name);
                                setNewName(name);
                                // 名前認識成功時のみ音声データを保存
                                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                                setNewVoiceBlob(blob);
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

    // Stop recording
    const handleStopRecording = (): Promise<Blob | null> => {
        // カウントダウンタイマーをクリア
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }
        return new Promise((resolve) => {
            if (mediaRecorderRef.current?.state === "recording") {
                mediaRecorderRef.current.addEventListener("stop", () => {
                    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                    resolve(blob);
                }, { once: true });
                mediaRecorderRef.current.stop();
            } else {
                resolve(newVoiceBlob);
            }
            if (recognitionRef.current) {
                try { recognitionRef.current.stop(); } catch { }
            }
        });
    };

    // Add new participant - handle recording in progress
    const handleAddNew = async () => {
        // 手動入力の場合は音声なし
        const useVoice = !isManualInput;
        let voiceBlob = useVoice ? newVoiceBlob : null;
        let name = newName.trim() || recognizedName || "";

        // If still recording and using voice, stop and wait for blob
        if (isRecording && useVoice) {
            voiceBlob = await handleStopRecording();
        } else if (isRecording) {
            // 手動入力時は録音を停止するが音声は使わない
            await handleStopRecording();
            voiceBlob = null;
        }

        // Must have name or recognized name
        if (!name && !recognizedName) return;
        name = name || recognizedName || "";

        // Add to members storage and participants list
        const newParticipant: ConfirmedParticipant = {
            id: `temp-${Date.now()}`,
            name: name,
            hasVoice: !!voiceBlob,
            voiceBlob: voiceBlob || undefined,
        };

        // Also save to IndexedDB for future use
        try {
            const duration = voiceBlob ? (Date.now() - recordingStartRef.current) / 1000 : 0;
            const savedMember = await addMember(name, voiceBlob || undefined, duration);
            newParticipant.id = savedMember.id;
        } catch (error) {
            console.error("Failed to save member:", error);
        }

        setParticipants((prev) => [...prev, newParticipant]);
        setNewName("");
        setNewVoiceBlob(null);
        setRecognizedName(null);
        setIsAddingNew(false);
        setIsManualInput(false);
    };

    // Cancel adding
    const handleCancelAdd = () => {
        setNewName("");
        setNewVoiceBlob(null);
        setIsAddingNew(false);
        setIsManualInput(false);
        setRecordingTimeLeft(10); // カウントダウンリセット
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }
        if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
        }
    };

    // Confirm and start
    const handleConfirm = () => {
        if (isFloating && onUpdate) {
            onUpdate(participants);
            onClose?.();
        } else {
            onConfirm(participants);
        }
    };

    // Get unselected members for adding
    const availableMembers = members.filter(
        (m) => !participants.some((p) => p.id === m.id)
    );

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
                <h2 className={styles.title}>
                    {isFloating ? "参加者を変更" : "参加者を確認"}
                </h2>
                <p className={styles.subtitle}>
                    {isFloating
                        ? "参加者の追加・削除ができます"
                        : "この参加者でよろしいですか？"}
                </p>
            </div>

            {/* Preset Info */}
            {preset && !isFloating && (
                <div className={styles.presetInfo}>
                    <span className={styles.presetIcon}>★</span>
                    <span>{preset.name}</span>
                </div>
            )}

            {/* Participant List */}
            <div className={styles.participantList}>
                {participants.length === 0 ? (
                    <div className={styles.emptyState}>
                        参加者がいません。<br />
                        下のボタンから追加してください。
                    </div>
                ) : (
                    participants.map((p) => (
                        <div key={p.id} className={styles.participantCard}>
                            <div className={styles.participantAvatar}>
                                <div className={styles.avatarInner} />
                            </div>
                            <div className={styles.participantInfo}>
                                <div className={styles.participantName}>{p.name}</div>
                                <div className={`${styles.participantVoice} ${p.hasVoice ? styles.voiceRecorded : ""}`}>
                                    {p.hasVoice ? "✓ 音声あり" : "音声なし"}
                                </div>
                            </div>
                            <button
                                className={styles.removeButton}
                                onClick={() => handleRemove(p.id)}
                            >
                                ×
                            </button>
                        </div>
                    ))
                )}
            </div>

            {/* Add Section */}
            <div className={styles.addSection}>
                {isAddingNew ? (
                    <div className={styles.addForm}>
                        <div className={styles.inputRow}>
                            <input
                                type="text"
                                className={styles.input}
                                value={newName}
                                onChange={(e) => {
                                    setNewName(e.target.value);
                                    // 手動入力時は音声データをクリア（認識済みでも上書き）
                                    setNewVoiceBlob(null);
                                    setRecognizedName(null);
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
                                    {newName ? `認識: ${newName}` : "「〇〇です」とお名前を..."}
                                </span>
                            </div>
                        )}

                        {!isRecording && recordingTimeLeft === 0 && !newVoiceBlob && (
                            <div className={styles.recordingComplete}>
                                ⏱️ 10秒経過 - 名前を入力するか、追加してください
                            </div>
                        )}

                        {newVoiceBlob && (
                            <div className={styles.voicePreview}>
                                🎵 音声録音済み
                            </div>
                        )}

                        <div className={styles.formButtons}>
                            <button className={styles.cancelFormButton} onClick={handleCancelAdd}>
                                キャンセル
                            </button>
                            <button
                                className={styles.confirmAddButton}
                                onClick={handleAddNew}
                                disabled={!newName.trim() && !recognizedName && !isRecording}
                            >
                                追加
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <button
                            className={styles.addButton}
                            onClick={() => setIsAddingNew(true)}
                        >
                            <span>+</span> 新しい参加者を追加
                        </button>

                        {/* Available members dropdown */}
                        {availableMembers.length > 0 && (
                            <div className={styles.memberSuggestions}>
                                <p className={styles.memberSuggestionsLabel}>登録済みメンバーから追加:</p>
                                <div className={styles.memberSuggestionsList}>
                                    {availableMembers.map((member) => (
                                        <button
                                            key={member.id}
                                            className={styles.addButton}
                                            onClick={() => handleAddExisting(member)}
                                        >
                                            <span>👤</span> {member.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Actions */}
            <div className={styles.actions}>
                <button className={styles.startButton} onClick={handleConfirm}>
                    {isFloating ? "✓ 確定" : isUploadMode ? "✨ 議事録生成" : "▶ Mtgスタート"}
                </button>
                <button
                    className={styles.cancelButton}
                    onClick={isFloating ? onClose : onCancel}
                >
                    {isFloating ? "閉じる" : "キャンセル"}
                </button>
            </div>
        </div>
    );
}

// Floating button component for recording screen
export function ParticipantEditButton({
    onClick,
    participantCount,
}: {
    onClick: () => void;
    participantCount: number;
}) {
    return (
        <button className={styles.floatingEditButton} onClick={onClick}>
            <span>👥</span>
            参加者 ({participantCount})
        </button>
    );
}
