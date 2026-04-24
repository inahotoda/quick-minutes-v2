"use client";

import { useState, useEffect } from "react";
import { Member, MemberType, MeetingPreset, getAllMembers, addMember } from "@/lib/member-storage";
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
    memberType?: MemberType;
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
    const [newCompany, setNewCompany] = useState("");
    const [newDepartment, setNewDepartment] = useState("");
    const [newRole, setNewRole] = useState("");
    const [newType, setNewType] = useState<MemberType>("client");
    const [showVoicePanel, setShowVoicePanel] = useState(false);
    const [loading, setLoading] = useState(true);

    // Use the shared voice recorder hook
    const voice = useVoiceRecorder();

    // Voice UI is disabled entirely during in-meeting (floating) mode
    // to avoid microphone conflicts with the active recording stream.
    const voiceAvailable = !isFloating;

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

    // Default new-member type based on preset mode
    useEffect(() => {
        if (preset?.mode === "business") setNewType("client");
        else if (preset?.mode === "internal") setNewType("internal");
    }, [preset?.mode]);

    // Sync recognized name from voice recorder (only when voice panel is active)
    useEffect(() => {
        if (showVoicePanel && voice.recognizedName && !voice.isManualInput) {
            setNewName(voice.recognizedName);
        }
    }, [voice.recognizedName, voice.isManualInput, showVoicePanel]);

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

    // Reset the add form
    const resetAddForm = () => {
        setNewName("");
        setNewCompany("");
        setNewDepartment("");
        setNewRole("");
        setShowVoicePanel(false);
        setIsAddingNew(false);
        voice.resetRecording();
    };

    // Add new participant
    const handleAddNew = async () => {
        const trimmedName = newName.trim();
        if (!trimmedName) return;

        const useVoice = voiceAvailable && showVoicePanel && !voice.isManualInput;
        let voiceBlob: Blob | null = useVoice ? voice.voiceBlob : null;
        let voiceDuration = useVoice ? voice.voiceDuration : 0;

        // Stop recording if still active (voice panel only)
        if (voice.isRecording) {
            const result = await voice.stopRecording();
            if (useVoice && result) {
                voiceBlob = result.blob;
                voiceDuration = result.duration;
            } else {
                voiceBlob = null;
            }
        }

        const newParticipant: ConfirmedParticipant = {
            id: `temp-${Date.now()}`,
            name: trimmedName,
            hasVoice: !!voiceBlob,
            voiceBlob: voiceBlob || undefined,
            company: newCompany.trim() || null,
            department: newDepartment.trim() || null,
            role: newRole.trim() || null,
            memberType: newType,
        };

        try {
            const savedMember = await addMember(trimmedName, {
                voiceBlob: voiceBlob || undefined,
                voiceDuration,
                company: newCompany.trim() || null,
                department: newDepartment.trim() || null,
                role: newRole.trim() || null,
                type: newType,
            });
            newParticipant.id = savedMember.id;
            newParticipant.company = savedMember.company ?? newParticipant.company;
            newParticipant.department = savedMember.department ?? newParticipant.department;
            newParticipant.role = savedMember.role ?? newParticipant.role;
            newParticipant.memberType = savedMember.type ?? newParticipant.memberType;
        } catch (error) {
            console.error("Failed to save member:", error);
        }

        setParticipants((prev) => [...prev, newParticipant]);
        resetAddForm();
    };

    // Cancel adding
    const handleCancelAdd = () => {
        resetAddForm();
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

    // Toggle voice panel (opt-in, not auto)
    const handleToggleVoice = async () => {
        if (!voiceAvailable) return;
        if (showVoicePanel) {
            if (voice.isRecording) {
                await voice.stopRecording();
            }
            voice.resetRecording();
            setShowVoicePanel(false);
        } else {
            setShowVoicePanel(true);
            setTimeout(() => {
                if (!voice.isRecording) voice.startRecording();
            }, 200);
        }
    };

    // Submit with Enter in the name field
    const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && newName.trim()) {
            e.preventDefault();
            handleAddNew();
        }
    };

    if (loading) {
        return (
            <div className={styles.container}>
                <p style={{ color: "rgba(255,255,255,0.5)" }}>読み込み中...</p>
            </div>
        );
    }

    const showCompanyField = newType === "client" || newType === "supplier" || newType === "other";

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
                        {/* Name (required) */}
                        <input
                            type="text"
                            className={styles.input}
                            value={newName}
                            onChange={(e) => {
                                setNewName(e.target.value);
                                voice.setIsManualInput(true);
                            }}
                            onKeyDown={handleNameKeyDown}
                            placeholder="名前（必須）"
                            autoFocus
                        />

                        {/* Type selector */}
                        <div className={styles.typeRow}>
                            {(["internal", "client", "supplier", "other"] as MemberType[]).map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    className={`${styles.typeChip} ${newType === t ? styles.typeChipActive : ""}`}
                                    onClick={() => setNewType(t)}
                                >
                                    {t === "internal" ? "社内" : t === "client" ? "顧客" : t === "supplier" ? "仕入先" : "その他"}
                                </button>
                            ))}
                        </div>

                        {/* Profile fields (always visible — 商談では会社名が最重要) */}
                        {showCompanyField && (
                            <input
                                type="text"
                                className={styles.input}
                                value={newCompany}
                                onChange={(e) => setNewCompany(e.target.value)}
                                placeholder={newType === "client" ? "会社名（推奨）" : "会社名（任意）"}
                            />
                        )}
                        <div className={styles.inputRow}>
                            <input
                                type="text"
                                className={styles.input}
                                value={newDepartment}
                                onChange={(e) => setNewDepartment(e.target.value)}
                                placeholder="部署（任意）"
                            />
                            <input
                                type="text"
                                className={styles.input}
                                value={newRole}
                                onChange={(e) => setNewRole(e.target.value)}
                                placeholder="役職（任意）"
                            />
                        </div>

                        {/* Voice recording (opt-in, not during in-meeting) */}
                        {voiceAvailable && (
                            <>
                                <button
                                    type="button"
                                    className={`${styles.voiceToggle} ${showVoicePanel ? styles.voiceToggleActive : ""}`}
                                    onClick={handleToggleVoice}
                                >
                                    {showVoicePanel ? "🎤 音声登録を中止" : "🎤 音声も登録（任意）"}
                                </button>

                                {showVoicePanel && voice.isRecording && (
                                    <div className={`${styles.recordingStatus} ${voice.recordingTimeLeft <= 3 ? styles.recordingWarning : ""}`}>
                                        <span className={styles.recordingDot} />
                                        <span className={styles.countdownTimer}>{voice.recordingTimeLeft}秒</span>
                                        <span className={styles.recordingText}>
                                            「〇〇です」とお名前を...
                                        </span>
                                    </div>
                                )}

                                {showVoicePanel && !voice.isRecording && voice.voiceBlob && (
                                    <div className={styles.voicePreview}>🎵 音声録音済み</div>
                                )}
                            </>
                        )}

                        <div className={styles.formButtons}>
                            <button className={styles.cancelFormButton} onClick={handleCancelAdd}>
                                キャンセル
                            </button>
                            <button
                                className={styles.confirmAddButton}
                                onClick={handleAddNew}
                                disabled={!newName.trim()}
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
            {participantCount === 0 ? "参加者を追加" : `参加者 (${participantCount})`}
        </button>
    );
}
