"use client";

import { useState, useEffect, useCallback } from "react";
import {
    Member,
    MemberType,
    MEMBER_TYPE_LABELS,
    getAllMembers,
    addMember,
    updateMember,
    deleteMember,
} from "@/lib/member-storage";
import MemberCard from "./MemberCard";
import MemberEditModal, { MemberFormData } from "./MemberEditModal";
import styles from "./member.module.css";

interface MemberManagerProps {
    onMembersChange?: (members: Member[]) => void;
    readOnly?: boolean;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
    const groups: Record<string, T[]> = {};
    for (const item of items) {
        const key = keyFn(item);
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
    }
    return groups;
}

const TAB_ORDER: MemberType[] = ["internal", "client", "supplier", "other"];

function classifyMemberType(member: Member): MemberType {
    if (member.type === "client") return "client";
    if (member.type === "supplier") return "supplier";
    if (member.type === "other") return "other";
    return "internal";
}

export default function MemberManager({ onMembersChange, readOnly = true }: MemberManagerProps) {
    const [members, setMembers] = useState<Member[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<MemberType>("internal");
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState("");
    const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingMember, setEditingMember] = useState<Member | null>(null);

    // Load members
    const loadMembers = useCallback(
        async (forceLocal: boolean = false) => {
            try {
                const data = await getAllMembers(forceLocal);
                setMembers(data);
                onMembersChange?.(data);
            } catch (error) {
                console.error("Failed to load members:", error);
            } finally {
                setLoading(false);
            }
        },
        [onMembersChange],
    );

    useEffect(() => {
        loadMembers();
    }, [loadMembers]);

    // Count members per type
    const countByType = (type: MemberType): number =>
        members.filter((m) => classifyMemberType(m) === type).length;

    // Filter members by active tab
    const tabMembers = members.filter((m) => classifyMemberType(m) === activeTab);

    // Search filter
    const filteredMembers = searchQuery.trim()
        ? tabMembers.filter((m) => {
              const q = searchQuery.toLowerCase();
              const nameMatch = m.name.toLowerCase().includes(q);
              const variantsMatch = (m.nameVariants || [])
                  .join(" ")
                  .toLowerCase()
                  .includes(q);
              const companyMatch = (m.company || "").toLowerCase().includes(q);
              const departmentMatch = (m.department || "").toLowerCase().includes(q);
              return nameMatch || variantsMatch || companyMatch || departmentMatch;
          })
        : tabMembers;

    // Group logic per tab
    const currentGroups: Record<string, Member[]> =
        activeTab === "internal"
            ? groupBy(filteredMembers, (m) => m.department || "未分類")
            : activeTab === "client"
              ? groupBy(filteredMembers, (m) => m.company || "その他")
              : activeTab === "supplier"
                ? groupBy(filteredMembers, (m) => m.company || "その他")
                : { all: filteredMembers }; // "other" tab: flat list

    // Sort group names, pushing fallback groups to end
    const sortedGroupNames = Object.keys(currentGroups).sort((a, b) => {
        if (a === "未分類" || a === "その他") return 1;
        if (b === "未分類" || b === "その他") return -1;
        return a.localeCompare(b, "ja");
    });

    const toggleGroup = (groupName: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupName)) next.delete(groupName);
            else next.add(groupName);
            return next;
        });
    };

    // Open add modal
    const handleOpenAddModal = () => {
        setEditingMember(null);
        setIsModalOpen(true);
    };

    // Open edit modal
    const handleOpenEditModal = (member: Member) => {
        setEditingMember(member);
        setIsModalOpen(true);
    };

    // Close modal
    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingMember(null);
    };

    // Save handler for MemberEditModal
    const handleSave = async (data: MemberFormData) => {
        try {
            if (editingMember) {
                // Editing existing member
                const updates: Partial<
                    Pick<
                        Member,
                        | "name"
                        | "nameVariants"
                        | "email"
                        | "company"
                        | "department"
                        | "role"
                        | "type"
                        | "voiceSample"
                    >
                > = {
                    name: data.name,
                    nameVariants: data.nameVariants,
                    email: data.email,
                    company: data.company,
                    department: data.department,
                    role: data.role,
                    type: data.type,
                };
                if (data.voiceBlob) {
                    updates.voiceSample = {
                        blob: data.voiceBlob,
                        duration: data.voiceDuration || 0,
                        recordedAt: new Date().toISOString(),
                    };
                }
                await updateMember(editingMember.id, updates);
            } else {
                // New member: addMember then updateMember with extra fields
                const newMember = await addMember(
                    data.name,
                    data.voiceBlob || undefined,
                    data.voiceBlob ? data.voiceDuration : undefined,
                );
                await updateMember(newMember.id, {
                    nameVariants: data.nameVariants,
                    email: data.email,
                    company: data.company,
                    department: data.department,
                    role: data.role,
                    type: data.type,
                });
            }

            await loadMembers(true);
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
            if (expandedMemberId === member.id) {
                setExpandedMemberId(null);
            }
            await loadMembers(true);
        } catch (error) {
            console.error("Failed to delete member:", error);
            alert("削除に失敗しました");
        }
    };

    // Render grouped list (with group headers), or flat list for "other" tab
    const renderGroupedList = () => {
        if (activeTab === "other") {
            // Flat list, no group headers
            const membersList = currentGroups["all"] || [];
            if (membersList.length === 0) {
                return (
                    <div className={styles.emptyState}>
                        <p className={styles.emptyText}>
                            {searchQuery
                                ? "検索結果がありません。"
                                : `${MEMBER_TYPE_LABELS[activeTab]}メンバーはまだ登録されていません。`}
                        </p>
                    </div>
                );
            }
            return (
                <div className={styles.memberList}>
                    {membersList.map((member) => (
                        <MemberCard
                            key={member.id}
                            member={member}
                            isExpanded={expandedMemberId === member.id}
                            onToggleExpand={() =>
                                setExpandedMemberId(
                                    expandedMemberId === member.id ? null : member.id,
                                )
                            }
                            onEdit={readOnly ? undefined : handleOpenEditModal}
                            onDelete={readOnly ? undefined : handleDelete}
                        />
                    ))}
                </div>
            );
        }

        // Grouped list
        if (sortedGroupNames.length === 0) {
            return (
                <div className={styles.emptyState}>
                    <p className={styles.emptyText}>
                        {searchQuery
                            ? "検索結果がありません。"
                            : `${MEMBER_TYPE_LABELS[activeTab]}メンバーはまだ登録されていません。`}
                    </p>
                </div>
            );
        }

        return (
            <div className={styles.groupedList}>
                {sortedGroupNames.map((groupName) => {
                    const isCollapsed = collapsedGroups.has(groupName);
                    const groupMembers = currentGroups[groupName];
                    return (
                        <div key={groupName} className={styles.group}>
                            <button
                                className={styles.groupHeader}
                                onClick={() => toggleGroup(groupName)}
                            >
                                <span
                                    className={`${styles.groupChevron} ${isCollapsed ? styles.groupChevronCollapsed : ""}`}
                                >
                                    ▾
                                </span>
                                <span className={styles.groupName}>{groupName}</span>
                                <span className={styles.groupCount}>
                                    {groupMembers.length}
                                </span>
                            </button>
                            {!isCollapsed && (
                                <div className={styles.memberList}>
                                    {groupMembers.map((member) => (
                                        <MemberCard
                                            key={member.id}
                                            member={member}
                                            isExpanded={expandedMemberId === member.id}
                                            onToggleExpand={() =>
                                                setExpandedMemberId(
                                                    expandedMemberId === member.id
                                                        ? null
                                                        : member.id,
                                                )
                                            }
                                            onEdit={handleOpenEditModal}
                                            onDelete={handleDelete}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
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
            {/* Read-only notice */}
            {readOnly && (
                <div style={{
                    padding: "0.75rem 1rem",
                    background: "rgba(99,102,241,0.08)",
                    border: "1px solid rgba(99,102,241,0.2)",
                    borderRadius: 10,
                    marginBottom: "1rem",
                    fontSize: "0.82rem",
                    color: "rgba(255,255,255,0.6)",
                    lineHeight: 1.5,
                }}>
                    メンバーの追加・編集は <strong style={{ color: "#a5b4fc" }}>INAHO Knowledge Portal</strong> から行えます。
                </div>
            )}

            {/* Header */}
            <div className={styles.header}>
                <h3 className={styles.title}>メンバー一覧</h3>
                {!readOnly && (
                    <button className={styles.addButton} onClick={handleOpenAddModal}>
                        <span>+</span> メンバー追加
                    </button>
                )}
            </div>

            {/* Search bar */}
            <input
                type="text"
                className={styles.searchBar}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="名前・会社・部署で検索..."
            />

            {/* Tabs */}
            <div className={styles.tabs}>
                {TAB_ORDER.map((tab) => {
                    const isActive = activeTab === tab;
                    const count = countByType(tab);
                    const label = MEMBER_TYPE_LABELS[tab];
                    return (
                        <button
                            key={tab}
                            className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {label}
                            <span className={styles.tabBadge}>{count}</span>
                        </button>
                    );
                })}
            </div>

            {/* Member list */}
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
                renderGroupedList()
            )}

            {/* Edit / Add Modal (read-only mode ではモーダルなし) */}
            {!readOnly && (
                <MemberEditModal
                    isOpen={isModalOpen}
                    editingMember={editingMember}
                    members={members}
                    onSave={handleSave}
                    onClose={handleCloseModal}
                />
            )}
        </div>
    );
}
