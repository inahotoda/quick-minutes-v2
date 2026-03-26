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

type PresetTab = "active" | "archived";

export default function PresetsPage() {
    const router = useRouter();
    const [presets, setPresets] = useState<MeetingPreset[]>([]);
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPreset, setEditingPreset] = useState<MeetingPreset | null>(null);
    const [activeTab, setActiveTab] = useState<PresetTab>("active");

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

    // Archive / restore preset
    const handleArchive = async (preset: MeetingPreset) => {
        try {
            await updatePreset(preset.id, { isArchived: true });
            await loadData();
        } catch (error) {
            console.error("Failed to archive preset:", error);
        }
    };

    const handleRestore = async (preset: MeetingPreset) => {
        try {
            await updatePreset(preset.id, { isArchived: false });
            await loadData();
        } catch (error) {
            console.error("Failed to restore preset:", error);
        }
    };

    // Filter presets by tab
    const activePresets = presets
        .filter((p) => !p.isArchived)
        .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    const archivedPresets = presets.filter((p) => p.isArchived);
    const displayedPresets = activeTab === "active" ? activePresets : archivedPresets;

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
                <h1 className={styles.title}>会議プリセット</h1>
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

                {/* Tabs: Active / Archived */}
                <div style={{
                    display: "flex",
                    gap: 0,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 10,
                    padding: 3,
                    marginBottom: "1rem",
                }}>
                    {([
                        { key: "active" as PresetTab, label: "アクティブ", count: activePresets.length },
                        { key: "archived" as PresetTab, label: "アーカイブ", count: archivedPresets.length },
                    ]).map(({ key, label, count }) => {
                        const isActive = activeTab === key;
                        return (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 8,
                                    padding: "0.5rem 0.75rem",
                                    background: isActive ? "rgba(99,102,241,0.2)" : "transparent",
                                    border: isActive ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
                                    borderRadius: 8,
                                    color: isActive ? "#a5b4fc" : "rgba(255,255,255,0.5)",
                                    fontSize: "0.85rem",
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    transition: "all 0.2s",
                                }}
                            >
                                {label}
                                <span style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minWidth: 20,
                                    height: 20,
                                    padding: "0 6px",
                                    background: isActive ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.1)",
                                    borderRadius: 10,
                                    fontSize: "0.7rem",
                                    fontWeight: 600,
                                }}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Preset List */}
                {displayedPresets.length === 0 ? (
                    <div className={styles.emptyState}>
                        <p>{activeTab === "active"
                            ? "アクティブなプリセットがありません。"
                            : "アーカイブされたプリセットはありません。"
                        }</p>
                    </div>
                ) : (
                    <div className={presetStyles.presetList}>
                        {displayedPresets.map((preset) => (
                            <div key={preset.id} className={presetStyles.presetCard} style={preset.isArchived ? { opacity: 0.6 } : undefined}>
                                <div className={presetStyles.presetIcon}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                </div>
                                <div className={presetStyles.presetInfo}>
                                    <div className={presetStyles.presetName}>
                                        {preset.name}
                                        {(preset.usageCount ?? 0) > 0 && (
                                            <span style={{ marginLeft: 8, fontSize: "0.7rem", color: "rgba(255,255,255,0.35)", fontWeight: 400 }}>
                                                {preset.usageCount}回使用
                                            </span>
                                        )}
                                    </div>
                                    <div className={presetStyles.presetMeta}>
                                        <span className={presetStyles.modeBadge}>{modeLabels[preset.mode]}</span>
                                        {preset.memberIds.length > 0 && (
                                            <span className={presetStyles.memberCount}>
                                                {preset.memberIds.length}名
                                            </span>
                                        )}
                                        {preset.lastUsedAt && (
                                            <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.35)" }}>
                                                最終: {new Date(preset.lastUsedAt).toLocaleDateString("ja-JP")}
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
                                    {preset.isArchived ? (
                                        <>
                                            <button
                                                className={presetStyles.actionButton}
                                                onClick={() => handleRestore(preset)}
                                                title="復元"
                                                style={{ fontSize: "0.75rem", padding: "0.4rem 0.6rem" }}
                                            >
                                                復元
                                            </button>
                                            <button
                                                className={`${presetStyles.actionButton} ${presetStyles.deleteButton}`}
                                                onClick={() => handleDelete(preset)}
                                                title="完全削除"
                                            >
                                                削除
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                className={presetStyles.actionButton}
                                                onClick={() => handleOpenEditModal(preset)}
                                                title="編集"
                                            >
                                                編集
                                            </button>
                                            <button
                                                className={presetStyles.actionButton}
                                                onClick={() => handleArchive(preset)}
                                                title="アーカイブ"
                                                style={{ fontSize: "0.75rem", padding: "0.4rem 0.6rem" }}
                                            >
                                                📦
                                            </button>
                                        </>
                                    )}
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
                            <label className={presetStyles.label}>
                                参加メンバー
                                {selectedMemberIds.length > 0 && (
                                    <span style={{ marginLeft: 8, fontSize: "0.78rem", color: "#a5b4fc", fontWeight: 400 }}>
                                        {selectedMemberIds.length}名選択中
                                    </span>
                                )}
                            </label>
                            {members.length === 0 ? (
                                <p className={presetStyles.noMembers}>
                                    メンバーが登録されていません
                                </p>
                            ) : (
                                <>
                                    {members.length >= 10 && (
                                        <input
                                            type="text"
                                            className={presetStyles.memberSearch}
                                            placeholder="名前・会社名で検索..."
                                            onChange={(e) => {
                                                const q = e.target.value.toLowerCase();
                                                document.querySelectorAll('[data-member-item]').forEach((el) => {
                                                    const name = el.getAttribute('data-member-name') || '';
                                                    const company = el.getAttribute('data-member-company') || '';
                                                    (el as HTMLElement).style.display =
                                                        !q || name.includes(q) || company.includes(q) ? '' : 'none';
                                                });
                                            }}
                                        />
                                    )}
                                    {/* 選択済みメンバー */}
                                    {selectedMemberIds.length > 0 && (
                                        <div className={presetStyles.memberGroupSection}>
                                            <div className={presetStyles.memberGroupLabel}>選択済み</div>
                                            <div className={presetStyles.memberGrid}>
                                                {members.filter(m => selectedMemberIds.includes(m.id)).map((member) => (
                                                    <label
                                                        key={member.id}
                                                        data-member-item
                                                        data-member-name={member.name.toLowerCase()}
                                                        data-member-company={(member.company || '').toLowerCase()}
                                                        className={`${presetStyles.memberCheckbox} ${presetStyles.memberCheckboxSelected}`}
                                                    >
                                                        <input type="checkbox" checked onChange={() => toggleMember(member.id)} />
                                                        <span>{member.name}</span>
                                                        {member.company && <span className={presetStyles.memberCompany}>{member.company}</span>}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {/* 社内 */}
                                    {(() => {
                                        const group = members.filter(m => (m.type === 'internal' || !m.type) && !selectedMemberIds.includes(m.id));
                                        if (group.length === 0) return null;
                                        return (
                                            <div className={presetStyles.memberGroupSection}>
                                                <div className={presetStyles.memberGroupLabel}>社内</div>
                                                <div className={presetStyles.memberGrid}>
                                                    {group.map((member) => (
                                                        <label key={member.id} data-member-item data-member-name={member.name.toLowerCase()} data-member-company={(member.company || '').toLowerCase()} className={presetStyles.memberCheckbox}>
                                                            <input type="checkbox" checked={false} onChange={() => toggleMember(member.id)} />
                                                            <span>{member.name}</span>
                                                            {member.department && <span className={presetStyles.memberCompany}>{member.department}</span>}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    {/* 顧客 */}
                                    {(() => {
                                        const group = members.filter(m => m.type === 'client' && !selectedMemberIds.includes(m.id));
                                        if (group.length === 0) return null;
                                        return (
                                            <div className={presetStyles.memberGroupSection}>
                                                <div className={presetStyles.memberGroupLabel}>顧客</div>
                                                <div className={presetStyles.memberGrid}>
                                                    {group.map((member) => (
                                                        <label key={member.id} data-member-item data-member-name={member.name.toLowerCase()} data-member-company={(member.company || '').toLowerCase()} className={presetStyles.memberCheckbox}>
                                                            <input type="checkbox" checked={false} onChange={() => toggleMember(member.id)} />
                                                            <span>{member.name}</span>
                                                            {member.company && <span className={presetStyles.memberCompany}>{member.company}</span>}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    {/* 仕入先 */}
                                    {(() => {
                                        const group = members.filter(m => m.type === 'supplier' && !selectedMemberIds.includes(m.id));
                                        if (group.length === 0) return null;
                                        return (
                                            <div className={presetStyles.memberGroupSection}>
                                                <div className={presetStyles.memberGroupLabel}>仕入先</div>
                                                <div className={presetStyles.memberGrid}>
                                                    {group.map((member) => (
                                                        <label key={member.id} data-member-item data-member-name={member.name.toLowerCase()} data-member-company={(member.company || '').toLowerCase()} className={presetStyles.memberCheckbox}>
                                                            <input type="checkbox" checked={false} onChange={() => toggleMember(member.id)} />
                                                            <span>{member.name}</span>
                                                            {member.company && <span className={presetStyles.memberCompany}>{member.company}</span>}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    {/* その他 */}
                                    {(() => {
                                        const group = members.filter(m => m.type === 'other' && !selectedMemberIds.includes(m.id));
                                        if (group.length === 0) return null;
                                        return (
                                            <div className={presetStyles.memberGroupSection}>
                                                <div className={presetStyles.memberGroupLabel}>その他</div>
                                                <div className={presetStyles.memberGrid}>
                                                    {group.map((member) => (
                                                        <label key={member.id} data-member-item data-member-name={member.name.toLowerCase()} data-member-company={(member.company || '').toLowerCase()} className={presetStyles.memberCheckbox}>
                                                            <input type="checkbox" checked={false} onChange={() => toggleMember(member.id)} />
                                                            <span>{member.name}</span>
                                                            {member.company && <span className={presetStyles.memberCompany}>{member.company}</span>}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </>
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
