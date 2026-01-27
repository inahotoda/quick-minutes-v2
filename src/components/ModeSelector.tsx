"use client";

import { MeetingMode } from "@/types";
import styles from "./ModeSelector.module.css";

interface ModeSelectorProps {
    selectedMode: MeetingMode;
    onModeChange: (mode: MeetingMode) => void;
}

const modes: { value: MeetingMode; label: string; icon: string }[] = [
    { value: "internal", label: "社内", icon: "🏢" },
    { value: "business", label: "商談", icon: "🤝" },
    { value: "other", label: "その他", icon: "📋" },
];

export default function ModeSelector({
    selectedMode,
    onModeChange,
}: ModeSelectorProps) {
    return (
        <div className={styles.container}>
            <div className={styles.buttons}>
                {modes.map((mode) => (
                    <button
                        key={mode.value}
                        className={`${styles.button} ${selectedMode === mode.value ? styles.active : ""}`}
                        onClick={() => onModeChange(mode.value)}
                    >
                        <span className={styles.icon}>{mode.icon}</span>
                        {mode.label}
                    </button>
                ))}
            </div>
        </div>
    );
}
