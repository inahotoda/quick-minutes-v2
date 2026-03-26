"use client";

import { useState } from "react";
import { MeetingPreset } from "@/lib/member-storage";
import styles from "./PresetGrid.module.css";

interface PresetGridProps {
    presets: MeetingPreset[];
    selectedPreset: MeetingPreset | null;
    onSelect: (preset: MeetingPreset | null) => void;
}

const MODE_LABELS: Record<string, string> = {
    internal: "社内",
    business: "商談",
    other: "その他",
};

const MODE_COLORS: Record<string, string> = {
    internal: "#a5b4fc",
    business: "#6ee7b7",
    other: "#d1d5db",
};

function formatDuration(duration?: number): string {
    if (!duration || duration === 0) return "無制限";
    return `${duration}分`;
}

export default function PresetGrid({ presets, selectedPreset, onSelect }: PresetGridProps) {
    const [showAll, setShowAll] = useState(false);

    if (presets.length === 0) return null;

    const topPresets = presets.slice(0, 4);
    const hasMore = presets.length > 4;
    const displayPresets = showAll ? presets : topPresets;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <span className={styles.label}>プリセット</span>
                {selectedPreset && (
                    <button className={styles.clearBtn} onClick={() => onSelect(null)}>
                        選択解除
                    </button>
                )}
            </div>

            <div className={styles.grid}>
                {displayPresets.map((preset) => {
                    const isSelected = selectedPreset?.id === preset.id;
                    const modeColor = MODE_COLORS[preset.mode] || MODE_COLORS.other;
                    return (
                        <button
                            key={preset.id}
                            className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}
                            onClick={() => onSelect(isSelected ? null : preset)}
                        >
                            <div className={styles.cardName}>{preset.name}</div>
                            <div className={styles.cardMeta}>
                                <span className={styles.cardMode} style={{ color: modeColor }}>
                                    {MODE_LABELS[preset.mode] || preset.mode}
                                </span>
                                <span className={styles.cardDot} />
                                <span>{formatDuration(preset.duration)}</span>
                                <span className={styles.cardDot} />
                                <span>
                                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ verticalAlign: "-1px", marginRight: 2 }}>
                                        <path d="M8 8a3 3 0 100-6 3 3 0 000 6zM2 14a6 6 0 0112 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                    </svg>
                                    {preset.memberIds?.length || 0}名
                                </span>
                            </div>
                            {isSelected && (
                                <div className={styles.selectedIndicator}>
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                                        <path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                            )}
                        </button>
                    );
                })}

                {hasMore && !showAll && (
                    <button className={`${styles.card} ${styles.cardMore}`} onClick={() => setShowAll(true)}>
                        <div className={styles.cardName}>+ その他</div>
                        <div className={styles.cardMeta}>
                            <span>残り {presets.length - 4} 件</span>
                        </div>
                    </button>
                )}
            </div>

            {!selectedPreset && (
                <div className={styles.noPresetLink}>
                    プリセットなしで開始
                </div>
            )}
        </div>
    );
}
