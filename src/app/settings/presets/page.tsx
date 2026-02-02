"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    MeetingPreset,
    MeetingDuration,
    Member,
    getAllPresets,
    getAllMembers,
    addPreset,
    updatePreset,
    deletePreset,
} from "@/lib/member-storage";
import styles from "../settings.module.css";
import presetStyles from "./presets.module.css";

export default function PresetsPage() {
    const router = useRouter();
    const [presets, setPresets] = useState<MeetingPreset[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPreset, setEditingPreset] = useState<MeetingPreset | null>(null);

    // Form state
    const [presetName, setPresetName] = useState("");
    const [presetMode, setPresetMode] = useState<"internal" | "business" | "other">("internal");
    const [presetDuration, setPresetDuration] = useState<MeetingDuration>(30);
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

    // Load data
    const loadData = useCallback(async () => {
        try {
            const [presetsData, membersData] = await Promise.all([
                getAllPresets(),
                getAllMembers(),
            ]);
            setPresets(presetsData);
            setMembers(membersData);
        } catch (error) {
            console.error("Failed to load data:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Mode labels
    const modeLabels = {
        internal: "社内MTG",
        business: "商談",
        other: "その他",
    };

    // Open add modal
    const handleOpenAddModal = () => {
        setEditingPreset(null);
        setPresetName("");
        setPresetMode("internal");
        setPresetDuration(30);
        setSelectedMemberIds([]);
        setIsModalOpen(true);
    };

    // Open edit modal
    const handleOpenEditModal = (preset: MeetingPreset) => {
        setEditingPreset(preset);
        setPresetName(preset.name);
        setPresetMode(preset.mode);
        setPresetDuration(preset.duration || 30);
        setSelectedMemberIds(preset.memberIds);
        setIsModalOpen(true);
    };

    // Close modal
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingPreset(null);
    };

    // Toggle member selection
    const toggleMember = (memberId: string) => {
        setSelectedMemberIds((prev) =>
            prev.includes(memberId)
                ? prev.filter((id) => id !== memberId)
                : [...prev, memberId]
        );
    };

    // Save preset
    const handleSave = async () => {
        if (!presetName.trim()) return;

        try {
            if (editingPreset) {
                await updatePreset(editingPreset.id, {
                    name: presetName.trim(),
                    mode: presetMode,
                    duration: presetDuration,
                    memberIds: selectedMemberIds,
                });
            } else {
                await addPreset(presetName.trim(), presetMode, selectedMemberIds, presetDuration);
            }
            await loadData();
            handleCloseModal();
        } catch (error) {
            console.error("Failed to save preset:", error);
            alert("保存に失敗しました");
        }
    };

    // Delete preset
    const handleDelete = async (preset: MeetingPreset) => {
        if (!confirm(`「${preset.name}」を削除しますか？`)) return;

        try {
            await deletePreset(preset.id);
            await loadData();
        } catch (error) {
            console.error("Failed to delete preset:", error);
            alert("削除に失敗しました");
        }
    };

    // Get member names for a preset
    const getMemberNames = (memberIds: string[]) => {
        return memberIds
            .map((id) => members.find((m) => m.id === id)?.name)
            .filter(Boolean)
            .join(", ");
    };

    if (loading) {
        return (
            <div className={styles.main}>
                <div className={styles.loading}>
                    <div className={styles.spinner} />
                    <p>読み込み中...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.main}>
            <header className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push("/settings")}>
                    ← 戻る
                </button>
                <h1 className={styles.title}>📅 会議プリセット</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.content}>
                <p className={styles.help}>
                    定例会議を登録しておくと、録音開始時に参加者が自動で設定されます。
                </p>

                {/* Header */}
                <div className={presetStyles.header}>
                    <h3 className={presetStyles.title}>登録済みプリセット</h3>
                    <button className={presetStyles.addButton} onClick={handleOpenAddModal}>
                        <span>+</span> 新規追加
                    </button>
                </div>

                {/* Preset List */}
                {presets.length === 0 ? (
                    <div className={styles.emptyState}>
                        <p>プリセットがまだ登録されていません。</p>
                    </div>
                ) : (
                    <div className={presetStyles.presetList}>
                        {presets.map((preset) => (
                            <div key={preset.id} className={presetStyles.presetCard}>
                                <div className={presetStyles.presetIcon}>
                                    {preset.mode === "business" ? "🤝" : preset.mode === "internal" ? "💼" : "📝"}
                                </div>
                                <div className={presetStyles.presetInfo}>
                                    <div className={presetStyles.presetName}>{preset.name}</div>
                                    <div className={presetStyles.presetMeta}>
                                        <span className={presetStyles.modeBadge}>{modeLabels[preset.mode]}</span>
                                        {preset.memberIds.length > 0 && (
                                            <span className={presetStyles.memberCount}>
                                                👥 {preset.memberIds.length}名
                                            </span>
                                        )}
                                    </div>
                                    {preset.memberIds.length > 0 && (
                                        <div className={presetStyles.memberList}>
                                            {getMemberNames(preset.memberIds) || "メンバー未設定"}
                                        </div>
                                    )}
                                </div>
                                <div className={presetStyles.presetActions}>
                                    <button
                                        className={presetStyles.actionButton}
                                        onClick={() => handleOpenEditModal(preset)}
                                    >
                                        ✏️
                                    </button>
                                    <button
                                        className={`${presetStyles.actionButton} ${presetStyles.deleteButton}`}
                                        onClick={() => handleDelete(preset)}
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {members.length === 0 && (
                    <div className={presetStyles.notice}>
                        💡 メンバーを先に登録すると、プリセットに追加できます。
                        <button
                            className={presetStyles.linkButton}
                            onClick={() => router.push("/settings/members")}
                        >
                            メンバー管理へ →
                        </button>
                    </div>
                )}
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className={presetStyles.modalOverlay} onClick={handleCloseModal}>
                    <div className={presetStyles.modal} onClick={(e) => e.stopPropagation()}>
                        <h2 className={presetStyles.modalTitle}>
                            {editingPreset ? "プリセット編集" : "新しいプリセット"}
                        </h2>

                        {/* Name */}
                        <div className={presetStyles.formGroup}>
                            <label className={presetStyles.label}>プリセット名</label>
                            <input
                                type="text"
                                className={presetStyles.input}
                                value={presetName}
                                onChange={(e) => setPresetName(e.target.value)}
                                placeholder="例: 週次定例、A社商談"
                                autoFocus
                            />
                        </div>

                        {/* Mode */}
                        <div className={presetStyles.formGroup}>
                            <label className={presetStyles.label}>会議モード</label>
                            <div className={presetStyles.modeSelector}>
                                {(["internal", "business", "other"] as const).map((mode) => (
                                    <button
                                        key={mode}
                                        className={`${presetStyles.modeButton} ${presetMode === mode ? presetStyles.modeButtonActive : ""
                                            }`}
                                        onClick={() => setPresetMode(mode)}
                                    >
                                        {modeLabels[mode]}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Duration */}
                        <div className={presetStyles.formGroup}>
                            <label className={presetStyles.label}>会議時間</label>
                            <div className={presetStyles.modeSelector}>
                                {([30, 60, 0] as const).map((duration) => (
                                    <button
                                        key={duration}
                                        className={`${presetStyles.modeButton} ${presetDuration === duration ? presetStyles.modeButtonActive : ""
                                            }`}
                                        onClick={() => setPresetDuration(duration)}
                                    >
                                        {duration === 0 ? "無制限" : `${duration}分`}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className={presetStyles.formGroup}>
                            <label className={presetStyles.label}>参加メンバー</label>
                            {members.length === 0 ? (
                                <p className={presetStyles.noMembers}>
                                    メンバーが登録されていません
                                </p>
                            ) : (
                                <div className={presetStyles.memberGrid}>
                                    {members.map((member) => (
                                        <label
                                            key={member.id}
                                            className={`${presetStyles.memberCheckbox} ${selectedMemberIds.includes(member.id)
                                                ? presetStyles.memberCheckboxSelected
                                                : ""
                                                }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedMemberIds.includes(member.id)}
                                                onChange={() => toggleMember(member.id)}
                                            />
                                            <span>{member.name}</span>
                                            {member.voiceSample && (
                                                <span className={presetStyles.voiceIcon}>🎵</span>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Actions */}
                        <div className={presetStyles.modalActions}>
                            <button className={presetStyles.cancelButton} onClick={handleCloseModal}>
                                キャンセル
                            </button>
                            <button
                                className={presetStyles.saveButton}
                                onClick={handleSave}
                                disabled={!presetName.trim()}
                            >
                                {editingPreset ? "更新" : "追加"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
