"use client";

import MemberAvatar from "../member/MemberAvatar";
import { MEMBER_TYPE_LABELS, MEMBER_TYPE_COLORS, MemberType } from "@/lib/member-storage";
import type { ConfirmedParticipant } from "./ParticipantConfirmation";
import styles from "./participant.module.css";

interface ParticipantCardProps {
    participant: ConfirmedParticipant;
    onRemove: (id: string) => void;
}

export default function ParticipantCard({ participant, onRemove }: ParticipantCardProps) {
    const p = participant;
    const memberType = p.memberType as MemberType | undefined;
    const typeColor = memberType ? MEMBER_TYPE_COLORS[memberType] : null;
    const typeLabel = memberType ? MEMBER_TYPE_LABELS[memberType] : null;

    // Build subtitle: company or department / role
    const subtitleParts: string[] = [];
    if (p.company) {
        subtitleParts.push(p.company);
    } else if (p.department) {
        subtitleParts.push(p.department);
    }
    if (p.role) {
        subtitleParts.push(p.role);
    }
    const subtitle = subtitleParts.join(" / ");

    return (
        <div className={styles.participantCard}>
            <MemberAvatar
                name={p.name}
                size="md"
                memberType={memberType}
                showTypeDot
            />
            <div className={styles.participantInfo}>
                <div className={styles.participantName}>
                    {p.name}
                    {typeLabel && typeColor && (
                        <span
                            className={styles.typeBadge}
                            style={{
                                background: typeColor.bg,
                                borderColor: typeColor.border,
                                color: typeColor.text,
                            }}
                        >
                            {typeLabel}
                        </span>
                    )}
                </div>
                {subtitle && (
                    <div className={styles.participantMeta}>{subtitle}</div>
                )}
                <div className={`${styles.participantVoice} ${p.hasVoice ? styles.voiceRecorded : ""}`}>
                    {p.hasVoice ? "✓ 音声あり" : "音声なし"}
                </div>
            </div>
            <button
                className={styles.removeButton}
                onClick={() => onRemove(p.id)}
            >
                ×
            </button>
        </div>
    );
}
