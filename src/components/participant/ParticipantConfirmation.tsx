"use client";

import { useState, useEffect } from "react";
import { Member, MeetingPreset, getAllMembers, addMember } from "@/lib/member-storage";
import { useVoiceRecorder } from "../member/VoiceRecorder";
import ParticipantCard from "./ParticipantCard";
import MemberPicker, { recordParticipantHistory } from "./MemberPicker";
import styles from "./participant.module.css";

// --- Exported types (backward compatible) ---

export interface ConfirmedParticipant {
    id: string;
    name: string;
    hasVoice: boolean;
    voiceBlob?: Blob;
    // Member profile (for Gemini injection)
    nameVariants?: string[];
    email?: string | null;
    company?: string | null;
    department?: string | null;
    role?: string | null;
    memberType?: "internal" | "client" | "supplier" | "other";
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
    // Pre-loaded members cache (skip getAllMembers if provided)
    initialMembers?: Member[];
}

// --- Main component ---

export default function ParticipantConfirmation({
    preset,
    onConfirm,
    onCancel,
    isFloating = false,
    currentParticipants = [],
    onUpdate,
    onClose,
    isUploadMode = false,
    initialMembers,
}: ParticipantConfirmationProps) {
    const [members, setMembers] = useState<Member[]>([]);
    const [participants, setParticipants] = useState<ConfirmedParticipant[]>([]);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [newName, setNewName] = useState("");
    const [loading, setLoading] = useState(true);

    // Use the shared voice recorder hook
    const voice = useVoiceRecorder();

    // Load members and initialize participants (only on initial mount)
    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            try {
                const allMembers = (initialMembers && initialMembers.length > 0) ? initialMembers : await getAllMembers();
                if (!isMounted) return;
                setMembers(allMembers);

                if (isFloating && currentParticipants.length > 0) {
                    setParticipants(currentParticipants);
                } else if (preset) {
                    const presetParticipants = preset.memberIds
                        .map((id) => {
                            const member = allMembers.find((m) => m.id === id);
                            if (!member) return null;
                            return {
                                id: member.id,
                                name: member.name,
                                hasVoice: !!member.voiceSample,
                                voiceBlob: member.voiceSample?.blob,
                                nameVariants: member.nameVariants,
                                email: member.email,
                                company: member.company,
                                department: member.department,
                                role: member.role,
                                memberType: member.type,
                            };
                        })
                        .filter(Boolean) as ConfirmedParticipant[];
                    setParticipants(presetParticipants);
                }
            } catch (error) {
                console.error("Failed to load members:", error);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        load();
        return () => { isMounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-start recording when adding new participant
    useEffect(() => {
        if (isAddingNew && !voice.isRecording && !newName) {
            const timer = setTimeout(() => {
                voice.startRecording();
            }, 300);
            return () => clearTimeout(timer);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAddingNew]);

    // Sync recognized name from voice recorder
    useEffect(() => {
        if (voice.recognizedName && !voice.isManualInput) {
            setNewName(voice.recognizedName);
        }
    }, [voice.recognizedName, voice.isManualInput]);

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
                nameVariants: member.nameVariants,
                email: member.email,
                company: member.company,
                department: member.department,
                role: member.role,
                memberType: member.type,
            },
        ]);
    };

    // Add new participant
    const handleAddNew = async () => {
        const useVoice = !voice.isManualInput;
        let voiceBlob = useVoice ? voice.voiceBlob : null;
        let voiceDuration = useVoice ? voice.voiceDuration : 0;
        let name = newName.trim() || voice.recognizedName || "";

        // Stop recording if still active
        if (voice.isRecording) {
            const result = await voice.stopRecording();
            if (useVoice && result) {
                voiceBlob = result.blob;
                voiceDuration = result.duration;
            } else {
                voiceBlob = null;
            }
        }

        if (!name && !voice.recognizedName) return;
        name = name || voice.recognizedName || "";

        const newParticipant: ConfirmedParticipant = {
            id: `temp-${Date.now()}`,
            name,
            hasVoice: !!voiceBlob,
            voiceBlob: voiceBlob || undefined,
        };

        // Save to IndexedDB for future use
        try {
            const savedMember = await addMember(name, voiceBlob || undefined, voiceDuration);
            newParticipant.id = savedMember.id;
        } catch (error) {
            console.error("Failed to save member:", error);
        }

        setParticipants((prev) => [...prev, newParticipant]);
        setNewName("");
        setIsAddingNew(false);
        voice.resetRecording();
    };

    // Cancel adding
    const handleCancelAdd = () => {
        setNewName("");
        setIsAddingNew(false);
        voice.resetRecording();
    };

    // Record usage for frequency tracking
    const recordMemberUsage = (memberIds: string[]) => {
        try {
            const usage = JSON.parse(localStorage.getItem("member-usage") || "{}");
            for (const id of memberIds) {
                usage[id] = (usage[id] || 0) + 1;
            }
            localStorage.setItem("member-usage", JSON.stringify(usage));
        } catch { /* ignore */ }
    };

    // Confirm and start
    const handleConfirm = () => {
        const ids = participants.map((p) => p.id);
        recordMemberUsage(ids);

        // Record participant history for preset
        if (preset?.id) {
            recordParticipantHistory(preset.id, ids);
        }

        if (isFloating && onUpdate) {
            onUpdate(participants);
            onClose?.();
        } else {
            onConfirm(participants);
        }
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
                        <ParticipantCard
                            key={p.id}
                            participant={p}
                            onRemove={handleRemove}
                        />
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
                                    voice.setIsManualInput(true);
                                }}
                                placeholder="名前のみ登録の場合は入力可"
                                autoFocus={!voice.isRecording}
                            />
                            <div
                                className={`${styles.micIndicator} ${voice.isRecording ? styles.micIndicatorActive : ""}`}
                                title={voice.isRecording ? "音声認識中..." : "音声認識待機中"}
                            >
                                <span className={styles.micIcon} />
                            </div>
                        </div>

                        {voice.isRecording && (
                            <div className={`${styles.recordingStatus} ${voice.recordingTimeLeft <= 3 ? styles.recordingWarning : ""}`}>
                                <span className={styles.recordingDot} />
                                <span className={styles.countdownTimer}>{voice.recordingTimeLeft}秒</span>
                                <span className={styles.recordingText}>
                                    {newName ? `認識: ${newName}` : "「〇〇です」とお名前を..."}
                                </span>
                            </div>
                        )}

                        {!voice.isRecording && voice.recordingTimeLeft === 0 && !voice.voiceBlob && (
                            <div className={styles.recordingComplete}>
                                ⏱️ 10秒経過 - 名前を入力するか、追加してください
                            </div>
                        )}

                        {voice.voiceBlob && (
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
                                disabled={!newName.trim() && !voice.recognizedName && !voice.isRecording}
                            >
                                追加
                            </button>
                        </div>
                    </div>
                ) : (
                    <MemberPicker
                        members={members}
                        participants={participants}
                        onAddExisting={handleAddExisting}
                        onStartAddNew={() => setIsAddingNew(true)}
                        presetId={preset?.id}
                    />
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

// Floating button component for recording screen (backward compatible export)
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
