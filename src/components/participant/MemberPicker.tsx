"use client";

import { useState, useMemo } from "react";
import MemberAvatar from "../member/MemberAvatar";
import { Member, MemberType, MEMBER_TYPE_LABELS } from "@/lib/member-storage";
import type { ConfirmedParticipant } from "./ParticipantConfirmation";
import styles from "./participant.module.css";

interface MemberPickerProps {
    members: Member[];
    participants: ConfirmedParticipant[];
    onAddExisting: (member: Member) => void;
    onStartAddNew: () => void;
    presetId?: string | null;
}

interface ParticipantHistoryEntry {
    presetId: string;
    memberIds: string[];
    date: string;
}

const HISTORY_KEY = "meeting-participant-history";
const USAGE_KEY = "member-usage";
const MAX_HISTORY = 5;
const FREQUENT_COUNT = 5;

// Type groups for display ordering
const TYPE_ORDER: MemberType[] = ["internal", "client", "supplier", "other"];
const TYPE_LABELS_WITH_ICON: Record<MemberType, string> = {
    internal: "社内",
    client: "顧客",
    supplier: "仕入先",
    other: "その他",
};

/** Record participant history for "same as last time" feature */
export function recordParticipantHistory(presetId: string, memberIds: string[]): void {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        const history: ParticipantHistoryEntry[] = raw ? JSON.parse(raw) : [];
        history.unshift({
            presetId,
            memberIds,
            date: new Date().toISOString(),
        });
        // Keep only last MAX_HISTORY entries
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
    } catch { /* ignore */ }
}

function getLastHistoryForPreset(presetId: string): string[] | null {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return null;
        const history: ParticipantHistoryEntry[] = JSON.parse(raw);
        const entry = history.find((h) => h.presetId === presetId);
        return entry ? entry.memberIds : null;
    } catch {
        return null;
    }
}

function getMemberUsageCount(memberId: string): number {
    try {
        const usage = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
        return usage[memberId] || 0;
    } catch {
        return 0;
    }
}

export default function MemberPicker({
    members,
    participants,
    onAddExisting,
    onStartAddNew,
    presetId,
}: MemberPickerProps) {
    const [search, setSearch] = useState("");

    // Available members (not yet selected), sorted by usage
    const availableMembers = useMemo(
        () =>
            members
                .filter((m) => !participants.some((p) => p.id === m.id))
                .sort((a, b) => getMemberUsageCount(b.id) - getMemberUsageCount(a.id)),
        [members, participants]
    );

    // Search filter
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return availableMembers;
        return availableMembers.filter(
            (m) =>
                m.name.toLowerCase().includes(q) ||
                m.company?.toLowerCase().includes(q) ||
                m.department?.toLowerCase().includes(q)
        );
    }, [availableMembers, search]);

    // Frequent members (top 5 with usage > 0) - only when not searching
    const frequentMembers = useMemo(() => {
        if (search.trim()) return [];
        return filtered.filter((m) => getMemberUsageCount(m.id) > 0).slice(0, FREQUENT_COUNT);
    }, [filtered, search]);

    const frequentIds = useMemo(() => new Set(frequentMembers.map((m) => m.id)), [frequentMembers]);

    // Group remaining members by type
    const groupedMembers = useMemo(() => {
        const remaining = filtered.filter((m) => !frequentIds.has(m.id));
        const groups: Record<MemberType, Member[]> = {
            internal: [],
            client: [],
            supplier: [],
            other: [],
        };
        for (const m of remaining) {
            const type = m.type || "other";
            groups[type].push(m);
        }
        return groups;
    }, [filtered, frequentIds]);

    // "Same as last time" handler
    const lastMemberIds = presetId ? getLastHistoryForPreset(presetId) : null;
    const handleLastTime = () => {
        if (!lastMemberIds) return;
        for (const id of lastMemberIds) {
            const member = members.find((m) => m.id === id);
            if (member && !participants.some((p) => p.id === member.id)) {
                onAddExisting(member);
            }
        }
    };

    if (availableMembers.length === 0 && !search.trim()) {
        return (
            <div className={styles.addSection}>
                <button className={styles.addNewButton} onClick={onStartAddNew}>
                    <span>+</span> 新しい参加者を追加
                </button>
            </div>
        );
    }

    return (
        <div className={styles.memberPicker}>
            {/* Add new button */}
            <button className={styles.addNewButton} onClick={onStartAddNew}>
                <span>+</span> 新しい参加者を追加
            </button>

            {/* "Same as last time" */}
            {lastMemberIds && lastMemberIds.length > 0 && (
                <button className={styles.lastTimeButton} onClick={handleLastTime}>
                    🔄 前回と同じ
                </button>
            )}

            {/* Search */}
            <input
                type="text"
                className={styles.pickerSearch}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 名前で検索..."
            />

            {/* Frequent members */}
            {frequentMembers.length > 0 && (
                <div className={styles.pickerSection}>
                    <p className={styles.pickerSectionLabel}>⭐ よく使うメンバー</p>
                    <div className={styles.pickerGrid}>
                        {frequentMembers.map((member) => (
                            <button
                                key={member.id}
                                className={styles.memberChip}
                                onClick={() => onAddExisting(member)}
                            >
                                <span className={styles.memberChipAvatar}>
                                    <MemberAvatar name={member.name} size="sm" memberType={member.type} />
                                </span>
                                {member.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Grouped by type */}
            {TYPE_ORDER.map((type) => {
                const group = groupedMembers[type];
                if (!group || group.length === 0) return null;
                return (
                    <div key={type} className={styles.pickerSection}>
                        <p className={styles.pickerSectionLabel}>{TYPE_LABELS_WITH_ICON[type]}</p>
                        <div className={styles.pickerGrid}>
                            {group.map((member) => (
                                <button
                                    key={member.id}
                                    className={styles.memberChip}
                                    onClick={() => onAddExisting(member)}
                                >
                                    <span className={styles.memberChipAvatar}>
                                        <MemberAvatar name={member.name} size="sm" memberType={member.type} />
                                    </span>
                                    {member.name}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}

            {/* No results */}
            {filtered.length === 0 && search.trim() && (
                <p className={styles.noResults}>「{search}」に一致するメンバーはいません</p>
            )}
        </div>
    );
}
