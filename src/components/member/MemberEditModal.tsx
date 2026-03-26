"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
    Member,
    MemberType,
    MEMBER_TYPE_LABELS,
    MEMBER_TYPE_COLORS,
} from "@/lib/member-storage";
import { useVoiceRecorder } from "./VoiceRecorder";
import styles from "./member.module.css";

export interface MemberFormData {
    name: string;
    nameVariants?: string[];
    email?: string | null;
    company?: string | null;
    department?: string | null;
    role?: string | null;
    type: MemberType;
    voiceBlob?: Blob | null;
    voiceDuration?: number;
}

interface MemberEditModalProps {
    isOpen: boolean;
    editingMember: Member | null; // null = new member
    members: Member[]; // for autocomplete suggestions
    onSave: (data: MemberFormData) => void;
    onClose: () => void;
}

const MEMBER_TYPES: MemberType[] = ["internal", "client", "supplier", "other"];

/** Format seconds to readable duration */
function formatDuration(seconds: number): string {
    const s = Math.round(seconds);
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}分${rem}秒` : `${m}分`;
}

export default function MemberEditModal({
    isOpen,
    editingMember,
    members,
    onSave,
    onClose,
}: MemberEditModalProps) {
    const isNewMember = editingMember === null;

    // Step management: new members start at step 1, editing starts at step 2
    const [step, setStep] = useState(isNewMember ? 1 : 2);

    // Form state
    const [name, setName] = useState("");
    const [nameVariants, setNameVariants] = useState("");
    const [email, setEmail] = useState("");
    const [company, setCompany] = useState("");
    const [department, setDepartment] = useState("");
    const [role, setRole] = useState("");
    const [memberType, setMemberType] = useState<MemberType>("internal");

    // Voice recorder hook
    const voice = useVoiceRecorder();

    // Autocomplete suggestions from existing members
    const companySuggestions = useMemo(() => {
        const companies = new Set<string>();
        members.forEach((m) => {
            if (m.company) companies.add(m.company);
        });
        return Array.from(companies).sort((a, b) => a.localeCompare(b, "ja"));
    }, [members]);

    const departmentSuggestions = useMemo(() => {
        const departments = new Set<string>();
        members.forEach((m) => {
            if (m.department) departments.add(m.department);
        });
        return Array.from(departments).sort((a, b) => a.localeCompare(b, "ja"));
    }, [members]);

    // Reset form when modal opens/closes or editingMember changes
    useEffect(() => {
        if (isOpen) {
            if (editingMember) {
                // Editing existing member: populate form and go to step 2
                setName(editingMember.name);
                setNameVariants((editingMember.nameVariants || []).join("、"));
                setEmail(editingMember.email || "");
                setCompany(editingMember.company || "");
                setDepartment(editingMember.department || "");
                setRole(editingMember.role || "");
                setMemberType(editingMember.type || "internal");
                setStep(2);
            } else {
                // New member: clear form and start at step 1
                setName("");
                setNameVariants("");
                setEmail("");
                setCompany("");
                setDepartment("");
                setRole("");
                setMemberType("internal");
                setStep(1);
                voice.resetRecording();
            }
        }
    }, [isOpen, editingMember]);

    // Auto-start recording when step 1 is shown for a new member
    useEffect(() => {
        if (isOpen && isNewMember && step === 1 && !voice.isRecording && !voice.voiceBlob) {
            const timer = setTimeout(() => {
                voice.startRecording();
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen, isNewMember, step]);

    // Sync recognized name from voice to the name field
    useEffect(() => {
        if (voice.recognizedName && !voice.isManualInput) {
            setName(voice.recognizedName);
        }
    }, [voice.recognizedName, voice.isManualInput]);

    // Handle close: stop recording and reset
    const handleClose = useCallback(() => {
        voice.resetRecording();
        onClose();
    }, [voice, onClose]);

    // Handle next step (step 1 -> step 2)
    const handleNextStep = useCallback(async () => {
        if (!name.trim()) return;

        // If still recording, stop it and capture the voice data
        if (voice.isRecording) {
            await voice.stopRecording();
        }

        setStep(2);
    }, [name, voice]);

    // Handle save
    const handleSave = useCallback(() => {
        if (!name.trim()) return;

        const variantsArray = nameVariants.trim()
            ? nameVariants.split(/[、,]/).map((v) => v.trim()).filter(Boolean)
            : undefined;

        const formData: MemberFormData = {
            name: name.trim(),
            nameVariants: variantsArray,
            email: email.trim() || null,
            company: company.trim() || null,
            department: department.trim() || null,
            role: role.trim() || null,
            type: memberType,
            voiceBlob: voice.isManualInput ? null : voice.voiceBlob,
            voiceDuration: voice.isManualInput ? 0 : voice.voiceDuration,
        };

        onSave(formData);
    }, [name, nameVariants, email, company, department, role, memberType, voice, onSave]);

    // Handle overlay click
    const handleOverlayClick = useCallback(
        (e: React.MouseEvent) => {
            if (e.target === e.currentTarget) {
                handleClose();
            }
        },
        [handleClose],
    );

    if (!isOpen) return null;

    const totalSteps = isNewMember ? 2 : 1;
    const currentStepDisplay = isNewMember ? step : 1;

    return (
        <div className={styles.modalOverlay} onClick={handleOverlayClick}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                {/* Title */}
                <h2 className={styles.modalTitle}>
                    {editingMember ? "メンバー編集" : "新しいメンバー"}
                </h2>

                {/* Step indicator */}
                {isNewMember && (
                    <div className={styles.stepIndicator}>
                        <span
                            className={`${styles.stepDot} ${step === 1 ? styles.stepDotActive : ""}`}
                        />
                        <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>
                            {step}/2
                        </span>
                        <span
                            className={`${styles.stepDot} ${step === 2 ? styles.stepDotActive : ""}`}
                        />
                    </div>
                )}

                {/* ============================== */}
                {/* Step 1: Name + Voice Recording */}
                {/* ============================== */}
                {step === 1 && isNewMember && (
                    <>
                        {/* Mic indicator + recording status */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 0" }}>
                            <div
                                className={`${styles.micIndicator} ${voice.isRecording ? styles.micIndicatorActive : ""}`}
                            >
                                <span className={styles.micIcon} />
                            </div>

                            {voice.isRecording && (
                                <div
                                    className={`${styles.recordingStatus} ${voice.recordingTimeLeft <= 3 ? styles.recordingWarning : ""}`}
                                >
                                    <span className={styles.recordingDot} />
                                    <span className={styles.countdownTimer}>
                                        {voice.recordingTimeLeft}秒
                                    </span>
                                    <span className={styles.recordingText}>
                                        {name
                                            ? `認識: ${name}`
                                            : "「〇〇です」とお名前を..."}
                                    </span>
                                </div>
                            )}

                            {!voice.isRecording && voice.recordingTimeLeft === 0 && !voice.voiceBlob && (
                                <div className={styles.recordingComplete}>
                                    10秒経過 - 名前を入力してください
                                </div>
                            )}
                        </div>

                        {/* Voice preview (when recording done) */}
                        {voice.voiceBlob && (
                            <div className={styles.voicePreviewCompact}>
                                <span className={styles.voicePreviewIcon}>🎵</span>
                                <span className={styles.voicePreviewText}>
                                    音声登録済み ({formatDuration(voice.voiceDuration)})
                                </span>
                                <button
                                    className={styles.playButton}
                                    onClick={() => {
                                        if (voice.voiceBlob) {
                                            const audio = new Audio(
                                                URL.createObjectURL(voice.voiceBlob),
                                            );
                                            audio.play();
                                        }
                                    }}
                                    title="音声を確認"
                                >
                                    ▶
                                </button>
                                <button
                                    className={styles.clearVoiceButton}
                                    onClick={() => voice.resetRecording()}
                                    title="音声をクリア"
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                        {/* Name input */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>名前</label>
                            <input
                                type="text"
                                className={styles.input}
                                value={name}
                                onChange={(e) => {
                                    setName(e.target.value);
                                    voice.setIsManualInput(true);
                                }}
                                placeholder="名前を入力（音声認識中は自動入力）"
                                autoFocus={!voice.isRecording}
                            />
                        </div>

                        {/* Next button */}
                        <div className={styles.modalActions}>
                            <button className={styles.cancelButton} onClick={handleClose}>
                                キャンセル
                            </button>
                            <button
                                className={styles.nextButton}
                                onClick={handleNextStep}
                                disabled={!name.trim()}
                            >
                                次へ
                            </button>
                        </div>
                    </>
                )}

                {/* ============================== */}
                {/* Step 2: Attribute form          */}
                {/* ============================== */}
                {step === 2 && (
                    <>
                        {/* Name (editable for existing members, read-only display for new) */}
                        {editingMember ? (
                            <div className={styles.formGroup}>
                                <label className={styles.label}>名前</label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="名前"
                                />
                            </div>
                        ) : (
                            <div
                                style={{
                                    padding: "8px 12px",
                                    background: "rgba(99,102,241,0.1)",
                                    border: "1px solid rgba(99,102,241,0.2)",
                                    borderRadius: 8,
                                    color: "#c7d2fe",
                                    fontSize: "0.95rem",
                                    fontWeight: 500,
                                    marginBottom: 12,
                                }}
                            >
                                {name}
                            </div>
                        )}

                        {/* 区分 (Type pills) */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>区分</label>
                            <div className={styles.typePills}>
                                {MEMBER_TYPES.map((t) => {
                                    const isActive = memberType === t;
                                    const color = MEMBER_TYPE_COLORS[t];
                                    return (
                                        <button
                                            key={t}
                                            type="button"
                                            className={`${styles.typePill} ${isActive ? styles.typePillActive : ""}`}
                                            style={
                                                isActive
                                                    ? {
                                                          background: color.bg,
                                                          borderColor: color.border,
                                                          color: color.text,
                                                      }
                                                    : undefined
                                            }
                                            onClick={() => setMemberType(t)}
                                        >
                                            {MEMBER_TYPE_LABELS[t]}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 会社名 */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>会社名</label>
                            <input
                                type="text"
                                className={styles.input}
                                value={company}
                                onChange={(e) => setCompany(e.target.value)}
                                placeholder="例: INAHO"
                                list="company-suggestions"
                            />
                            <datalist id="company-suggestions">
                                {companySuggestions.map((c) => (
                                    <option key={c} value={c} />
                                ))}
                            </datalist>
                        </div>

                        {/* 部署 */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>部署</label>
                            <input
                                type="text"
                                className={styles.input}
                                value={department}
                                onChange={(e) => setDepartment(e.target.value)}
                                placeholder="例: 営業部"
                                list="department-suggestions"
                            />
                            <datalist id="department-suggestions">
                                {departmentSuggestions.map((d) => (
                                    <option key={d} value={d} />
                                ))}
                            </datalist>
                        </div>

                        {/* 役職 */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>役職</label>
                            <input
                                type="text"
                                className={styles.input}
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                                placeholder="例: CEO"
                            />
                        </div>

                        {/* メールアドレス */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>メールアドレス</label>
                            <input
                                type="email"
                                className={styles.input}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="例: user@example.com"
                            />
                        </div>

                        {/* 呼び名 */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>呼び名（「、」または「,」区切り）</label>
                            <input
                                type="text"
                                className={styles.input}
                                value={nameVariants}
                                onChange={(e) => setNameVariants(e.target.value)}
                                placeholder="例: 戸田さん、CEO、toda"
                            />
                        </div>

                        {/* Voice section */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>音声サンプル</label>
                            {(voice.voiceBlob || editingMember?.voiceSample) && !voice.isRecording ? (
                                <div className={styles.voicePreviewCompact}>
                                    <span className={styles.voicePreviewIcon}>🎵</span>
                                    <span className={styles.voicePreviewText}>
                                        音声登録済み (
                                        {formatDuration(
                                            voice.voiceBlob
                                                ? voice.voiceDuration
                                                : editingMember?.voiceSample?.duration || 0,
                                        )}
                                        )
                                    </span>
                                    <button
                                        className={styles.playButton}
                                        onClick={() => {
                                            try {
                                                let audioUrl: string | null = null;
                                                if (voice.voiceBlob instanceof Blob) {
                                                    audioUrl = URL.createObjectURL(voice.voiceBlob);
                                                } else if (editingMember?.voiceSample) {
                                                    const vs = editingMember.voiceSample as any;
                                                    if (vs.blob instanceof Blob) {
                                                        audioUrl = URL.createObjectURL(vs.blob);
                                                    } else if (vs.blobBase64) {
                                                        const byteChars = atob(vs.blobBase64);
                                                        const byteNums = new Array(byteChars.length);
                                                        for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
                                                        const blob = new Blob([new Uint8Array(byteNums)], { type: "audio/webm" });
                                                        audioUrl = URL.createObjectURL(blob);
                                                    }
                                                }
                                                if (audioUrl) new Audio(audioUrl).play();
                                            } catch (err) {
                                                console.error("Voice playback error:", err);
                                            }
                                        }}
                                        title="音声を確認"
                                    >
                                        ▶
                                    </button>
                                    <button
                                        style={{
                                            background: "rgba(99,102,241,0.15)",
                                            border: "1px solid rgba(99,102,241,0.3)",
                                            borderRadius: 4,
                                            color: "#a5b4fc",
                                            cursor: "pointer",
                                            padding: "2px 10px",
                                            fontSize: "0.75rem",
                                        }}
                                        onClick={() => {
                                            voice.resetRecording();
                                            voice.startRecording();
                                        }}
                                        title="再録音"
                                    >
                                        再録音
                                    </button>
                                </div>
                            ) : voice.isRecording ? (
                                <div style={{ padding: "12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)" }}>
                                    <div
                                        className={`${styles.recordingStatus} ${voice.recordingTimeLeft <= 3 ? styles.recordingWarning : ""}`}
                                    >
                                        <span className={styles.recordingDot} />
                                        <span className={styles.countdownTimer}>
                                            {voice.recordingTimeLeft}秒
                                        </span>
                                        <span className={styles.recordingText}>
                                            「〇〇です」とお名前を...
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => voice.startRecording()}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 8,
                                        width: "100%",
                                        padding: "0.7rem",
                                        background: "transparent",
                                        border: "1px dashed rgba(255,255,255,0.2)",
                                        borderRadius: 8,
                                        color: "rgba(255,255,255,0.5)",
                                        fontSize: "0.85rem",
                                        cursor: "pointer",
                                        transition: "all 0.2s",
                                    }}
                                >
                                    🎙️ 音声を録音する
                                </button>
                            )}
                        </div>

                        {/* Actions */}
                        <div className={styles.modalActions}>
                            {isNewMember ? (
                                <button
                                    className={styles.cancelButton}
                                    onClick={() => setStep(1)}
                                >
                                    戻る
                                </button>
                            ) : (
                                <button className={styles.cancelButton} onClick={handleClose}>
                                    キャンセル
                                </button>
                            )}
                            <button
                                className={styles.saveButton}
                                onClick={handleSave}
                                disabled={!name.trim()}
                            >
                                保存
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
