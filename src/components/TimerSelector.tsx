"use client";

import { MeetingDuration } from "@/lib/member-storage";
import styles from "./TimerSelector.module.css";

interface TimerSelectorProps {
    selected: MeetingDuration;
    onChange: (duration: MeetingDuration) => void;
    disabled?: boolean;
}

const DURATIONS: { value: MeetingDuration; label: string }[] = [
    { value: 15, label: "15分" },
    { value: 30, label: "30分" },
    { value: 45, label: "45分" },
];

export default function TimerSelector({
    selected,
    onChange,
    disabled = false,
}: TimerSelectorProps) {
    return (
        <div className={styles.container}>
            <label className={styles.label}>会議時間</label>
            <div className={styles.buttons}>
                {DURATIONS.map(({ value, label }) => (
                    <button
                        key={value}
                        className={`${styles.button} ${selected === value ? styles.selected : ""}`}
                        onClick={() => onChange(value)}
                        disabled={disabled}
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}
