"use client";

import { useState, useRef, useCallback } from "react";
import {
    Member,
    MemberType,
    MEMBER_TYPE_LABELS,
    MEMBER_TYPE_COLORS,
} from "@/lib/member-storage";
import MemberAvatar from "./MemberAvatar";
import styles from "./member.module.css";

interface MemberCardProps {
    member: Member;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onEdit: (member: Member) => void;
    onDelete: (member: Member) => void;
}

/** Format seconds to a human-readable Japanese duration string */
function formatDuration(seconds: number): string {
    const s = Math.round(seconds);
    if (s < 60) return `${s}秒`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}分${rem}秒` : `${m}分`;
}

export default function MemberCard({
    member,
    isExpanded,
    onToggleExpand,
    onEdit,
    onDelete,
}: MemberCardProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState(0);

    const memberType: MemberType = member.type || "other";
    const typeLabel = MEMBER_TYPE_LABELS[memberType];
    const typeColor = MEMBER_TYPE_COLORS[memberType];
    const hasVoice = !!member.voiceSample;

    // Measure expanded content height for smooth animation
    const measureHeight = useCallback((node: HTMLDivElement | null) => {
        if (node) {
            contentRef.current = node;
            setContentHeight(node.scrollHeight);
        }
    }, []);

    // Play voice sample (supports both Blob and base64 formats)
    const handlePlayVoice = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!member.voiceSample) return;
        try {
            const vs = member.voiceSample as any;
            let audioUrl: string;
            if (vs.blob instanceof Blob) {
                audioUrl = URL.createObjectURL(vs.blob);
            } else if (vs.blobBase64) {
                // Fallback: base64 → Blob → URL
                const byteCharacters = atob(vs.blobBase64);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: "audio/webm" });
                audioUrl = URL.createObjectURL(blob);
            } else {
                return;
            }
            const audio = new Audio(audioUrl);
            audio.play();
        } catch (err) {
            console.error("Voice playback error:", err);
        }
    };

    return (
        <div
            className={`${styles.memberCard} ${isExpanded ? styles.memberCardExpanded : ""}`}
            onClick={onToggleExpand}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onToggleExpand();
                }
            }}
        >
            {/* Compact row: always visible */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
                <MemberAvatar
                    name={member.name}
                    size="sm"
                    memberType={memberType}
                    showTypeDot
                />

                {/* Name + meta info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={styles.memberName}>{member.name}</span>
                        {member.role && (
                            <span className={styles.memberRole}>{member.role}</span>
                        )}
                    </div>
                    {/* Compact sub-info: company / department / email (PC only) */}
                    {!isExpanded && (member.company || member.department || member.email) && (
                        <div
                            style={{
                                fontSize: "0.75rem",
                                color: "rgba(255,255,255,0.4)",
                                marginTop: 2,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {[member.company, member.department].filter(Boolean).join(" / ")}
                            {member.email && (
                                <span style={{ marginLeft: 8, color: "rgba(99,102,241,0.5)" }}>
                                    {member.email}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Right side: badge + voice + chevron */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span
                        className={styles.typeBadge}
                        style={{
                            background: typeColor.bg,
                            border: `1px solid ${typeColor.border}`,
                            color: typeColor.text,
                        }}
                    >
                        {typeLabel}
                    </span>

                    {/* Voice icon */}
                    <span
                        className={styles.voiceIcon}
                        title={hasVoice ? "音声登録済み" : "音声未登録"}
                        style={{ color: hasVoice ? "#10b981" : "rgba(255,255,255,0.25)" }}
                    >
                        {hasVoice ? (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                <path
                                    d="M13.5 4.5L6.5 11.5L2.5 7.5"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                <path
                                    d="M8 1a2.5 2.5 0 00-2.5 2.5v4a2.5 2.5 0 005 0v-4A2.5 2.5 0 008 1z"
                                    stroke="currentColor"
                                    strokeWidth="1.2"
                                />
                                <path
                                    d="M4 7.5a4 4 0 008 0M8 12.5v2"
                                    stroke="currentColor"
                                    strokeWidth="1.2"
                                    strokeLinecap="round"
                                />
                            </svg>
                        )}
                    </span>

                    {/* Expand chevron - far right */}
                    <span
                        style={{
                            fontSize: "0.7rem",
                            color: "rgba(255,255,255,0.3)",
                            transition: "transform 0.2s ease",
                            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                            padding: "4px",
                        }}
                    >
                        ▼
                    </span>
                </div>
            </div>

            {/* Expanded section with max-height transition */}
            <div
                ref={measureHeight}
                className={styles.expandedInfo}
                style={{
                    maxHeight: isExpanded ? contentHeight + 20 : 0,
                    opacity: isExpanded ? 1 : 0,
                    overflow: "hidden",
                    transition: "max-height 0.3s ease, opacity 0.25s ease",
                }}
            >
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "8px 16px",
                        paddingTop: 12,
                        fontSize: "0.82rem",
                        color: "rgba(255,255,255,0.7)",
                    }}
                >
                    {member.company && (
                        <div>
                            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.75rem" }}>会社</span>
                            <div>{member.company}</div>
                        </div>
                    )}
                    {member.department && (
                        <div>
                            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.75rem" }}>部署</span>
                            <div>{member.department}</div>
                        </div>
                    )}
                    {member.email && (
                        <div>
                            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.75rem" }}>メール</span>
                            <div>{member.email}</div>
                        </div>
                    )}
                    {member.nameVariants && member.nameVariants.length > 0 && (
                        <div>
                            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.75rem" }}>呼び名</span>
                            <div>{member.nameVariants.join("、")}</div>
                        </div>
                    )}
                    {member.voiceSample && (
                        <div>
                            <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.75rem" }}>音声</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span>{formatDuration(member.voiceSample.duration)}</span>
                                <button
                                    onClick={handlePlayVoice}
                                    style={{
                                        background: "rgba(99,102,241,0.2)",
                                        border: "1px solid rgba(99,102,241,0.3)",
                                        borderRadius: 4,
                                        color: "#a5b4fc",
                                        cursor: "pointer",
                                        padding: "2px 8px",
                                        fontSize: "0.75rem",
                                    }}
                                >
                                    ▶ 再生
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Action buttons */}
                <div className={styles.memberActions} style={{ paddingTop: 12 }}>
                    <button
                        className={styles.actionButton}
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit(member);
                        }}
                        title="編集"
                    >
                        編集
                    </button>
                    <button
                        className={`${styles.actionButton} ${styles.deleteButton}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(member);
                        }}
                        title="削除"
                    >
                        削除
                    </button>
                </div>
            </div>
        </div>
    );
}
