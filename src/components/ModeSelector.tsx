"use client";

import { useState, useEffect } from "react";
import { MeetingMode } from "@/types";
import { MeetingPreset, getAllPresets } from "@/lib/member-storage";
import styles from "./ModeSelector.module.css";

interface ModeSelectorProps {
    selectedMode: MeetingMode;
    onModeChange: (mode: MeetingMode) => void;
    selectedPreset?: MeetingPreset | null;
    onPresetChange?: (preset: MeetingPreset | null) => void;
}

const modes: { value: MeetingMode; label: string; icon: string }[] = [
    { value: "internal", label: "社内", icon: "🏢" },
    { value: "business", label: "商談", icon: "🤝" },
    { value: "other", label: "その他", icon: "📋" },
];

export default function ModeSelector({
    selectedMode,
    onModeChange,
    selectedPreset,
    onPresetChange,
}: ModeSelectorProps) {
    const [presets, setPresets] = useState<MeetingPreset[]>([]);
    const [isPresetOpen, setIsPresetOpen] = useState(false);

    // Load presets
    useEffect(() => {
        const load = async () => {
            try {
                const data = await getAllPresets();
                setPresets(data);
            } catch (error) {
                console.error("Failed to load presets:", error);
            }
        };
        load();
    }, []);

    // Handle mode click
    const handleModeClick = (mode: MeetingMode) => {
        onModeChange(mode);
        onPresetChange?.(null); // Clear preset when mode is manually selected
    };

    // Handle preset selection
    const handlePresetSelect = (preset: MeetingPreset) => {
        onModeChange(preset.mode);
        onPresetChange?.(preset);
        setIsPresetOpen(false);
    };

    // Clear preset
    const handleClearPreset = () => {
        onPresetChange?.(null);
    };

    return (
        <div className={styles.container}>
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

            {/* Preset Section */}
            {presets.length > 0 && onPresetChange && (
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

                    {/* Preset Dropdown */}
                    {isPresetOpen && !selectedPreset && (
                        <div className={styles.presetDropdown}>
                            {presets.map((preset) => (
                                <button
                                    key={preset.id}
                                    className={styles.presetItem}
                                    onClick={() => handlePresetSelect(preset)}
                                >
                                    <span className={styles.presetItemIcon}>
                                        {preset.mode === "business" ? "🤝" : preset.mode === "internal" ? "💼" : "📝"}
                                    </span>
                                    <span className={styles.presetItemName}>{preset.name}</span>
                                    {preset.memberIds.length > 0 && (
                                        <span className={styles.presetItemCount}>
                                            👥 {preset.memberIds.length}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
