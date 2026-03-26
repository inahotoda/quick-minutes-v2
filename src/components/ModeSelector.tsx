"use client";

import { useState, useEffect, useMemo } from "react";
import { MeetingMode } from "@/types";
import { MeetingPreset, getAllPresets } from "@/lib/member-storage";
import styles from "./ModeSelector.module.css";

interface ModeSelectorProps {
    selectedMode: MeetingMode;
    onModeChange: (mode: MeetingMode) => void;
    selectedPreset?: MeetingPreset | null;
    onPresetChange?: (preset: MeetingPreset | null) => void;
    hidePresets?: boolean;
    compact?: boolean;
    additionalPrompt?: string;
    onAdditionalPromptChange?: (value: string) => void;
}

const modes: { value: MeetingMode; label: string; icon: string }[] = [
    { value: "internal", label: "社内", icon: "🏢" },
    { value: "business", label: "商談", icon: "🤝" },
    { value: "other", label: "その他", icon: "📋" },
];

const modeIcons: Record<string, string> = {
    internal: "💼",
    business: "🤝",
    other: "📝",
};

export default function ModeSelector({
    selectedMode,
    onModeChange,
    selectedPreset,
    onPresetChange,
    hidePresets = false,
    compact = false,
    additionalPrompt = "",
    onAdditionalPromptChange,
}: ModeSelectorProps) {
    const [presets, setPresets] = useState<MeetingPreset[]>([]);
    const [isPresetOpen, setIsPresetOpen] = useState(false);
    const [isPromptOpen, setIsPromptOpen] = useState(false);
    const [presetSearch, setPresetSearch] = useState("");

    // Load presets (exclude archived, sort by usage)
    useEffect(() => {
        const load = async () => {
            try {
                const data = await getAllPresets();
                const active = data
                    .filter((p) => !p.isArchived)
                    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
                setPresets(active);
            } catch (error) {
                console.error("Failed to load presets:", error);
            }
        };
        load();
    }, []);

    // Split into recent (top 3 with usage) and others
    const recentPresets = useMemo(
        () => presets.filter((p) => (p.usageCount || 0) > 0).slice(0, 3),
        [presets],
    );
    const recentIds = useMemo(() => new Set(recentPresets.map((p) => p.id)), [recentPresets]);

    // Filtered presets for search
    const filteredOther = useMemo(() => {
        const others = presets.filter((p) => !recentIds.has(p.id));
        if (!presetSearch.trim()) return others;
        const q = presetSearch.trim().toLowerCase();
        return presets.filter((p) => p.name.toLowerCase().includes(q));
    }, [presets, recentIds, presetSearch]);

    // Handle mode click
    const handleModeClick = (mode: MeetingMode) => {
        onModeChange(mode);
        onPresetChange?.(null);
    };

    // Handle preset selection
    const handlePresetSelect = (preset: MeetingPreset) => {
        onModeChange(preset.mode);
        onPresetChange?.(preset);
        setIsPresetOpen(false);
        setPresetSearch("");
    };

    // Clear preset
    const handleClearPreset = () => {
        onPresetChange?.(null);
    };

    // Render a preset chip
    const renderPresetChip = (preset: MeetingPreset) => (
        <button
            key={preset.id}
            className={styles.presetChip}
            onClick={() => handlePresetSelect(preset)}
        >
            <span className={styles.presetChipIcon}>{modeIcons[preset.mode] || "📝"}</span>
            <span className={styles.presetChipName}>{preset.name}</span>
            <span className={styles.presetChipCount}>👥{preset.memberIds.length}</span>
        </button>
    );

    return (
        <div className={`${styles.container} ${compact ? styles.compact : ''}`}>
            {/* Mode Buttons */}
            <div className={styles.buttons}>
                {modes.map((mode) => (
                    <button
                        key={mode.value}
                        className={`${styles.button} ${selectedMode === mode.value ? styles.active : ""} ${selectedPreset ? styles.locked : ""}`}
                        onClick={() => handleModeClick(mode.value)}
                        disabled={!!selectedPreset}
                    >
                        <span className={styles.icon}>{mode.icon}</span>
                        {mode.label}
                    </button>
                ))}
            </div>

            {/* 追加の指示（プロンプト） — compact時のみ表示 */}
            {onAdditionalPromptChange && (
                <div className={styles.promptSection}>
                    <button
                        className={`${styles.promptToggle} ${isPromptOpen ? styles.promptToggleOpen : ''} ${additionalPrompt ? styles.promptToggleActive : ''}`}
                        onClick={() => setIsPromptOpen(!isPromptOpen)}
                    >
                        <span className={styles.toggleArrow}>{isPromptOpen ? "▲" : "▼"}</span>
                        <span>📝 追加の指示（プロンプト）</span>
                    </button>
                    {isPromptOpen && (
                        <textarea
                            className={styles.promptInput}
                            value={additionalPrompt}
                            onChange={(e) => onAdditionalPromptChange(e.target.value)}
                            placeholder="例: 日本語と英語の併記にして / タスクを全て拾って"
                            rows={3}
                        />
                    )}
                </div>
            )}

            {/* Preset Section — hidePresets時は非表示 */}
            {!hidePresets && presets.length > 0 && onPresetChange && (
                <div className={styles.presetSection}>
                    {selectedPreset ? (
                        <div className={styles.selectedPreset}>
                            <span className={styles.presetIcon}>⭐</span>
                            <span className={styles.presetName}>{selectedPreset.name}</span>
                            <button
                                className={styles.clearPreset}
                                onClick={handleClearPreset}
                            >
                                ×
                            </button>
                        </div>
                    ) : (
                        <button
                            className={styles.presetToggle}
                            onClick={() => setIsPresetOpen(!isPresetOpen)}
                        >
                            <span>⭐</span>
                            定例会議（プリセット）
                            <span className={styles.toggleArrow}>
                                {isPresetOpen ? "▲" : "▼"}
                            </span>
                        </button>
                    )}

                    {/* Preset Dropdown - Redesigned */}
                    {isPresetOpen && !selectedPreset && (
                        <div className={styles.presetDropdown}>
                            {/* Search (show when 5+ presets) */}
                            {presets.length >= 5 && (
                                <input
                                    type="text"
                                    className={styles.presetSearchInput}
                                    value={presetSearch}
                                    onChange={(e) => setPresetSearch(e.target.value)}
                                    placeholder="検索..."
                                    autoFocus
                                />
                            )}

                            {!presetSearch.trim() && (
                                <>
                                    {/* Recent presets */}
                                    {recentPresets.length > 0 && (
                                        <div className={styles.presetGroup}>
                                            <div className={styles.presetGroupLabel}>よく使う</div>
                                            <div className={styles.presetChipGrid}>
                                                {recentPresets.map(renderPresetChip)}
                                            </div>
                                        </div>
                                    )}

                                    {/* Other presets */}
                                    {filteredOther.length > 0 && (
                                        <div className={styles.presetGroup}>
                                            {recentPresets.length > 0 && (
                                                <div className={styles.presetGroupLabel}>その他</div>
                                            )}
                                            <div className={styles.presetChipGrid}>
                                                {filteredOther.map(renderPresetChip)}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Search results */}
                            {presetSearch.trim() && (
                                <div className={styles.presetChipGrid}>
                                    {filteredOther.length > 0 ? (
                                        filteredOther.map(renderPresetChip)
                                    ) : (
                                        <div className={styles.presetNoResults}>
                                            該当なし
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
