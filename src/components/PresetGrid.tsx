"use client";

import { useState, useRef, useEffect } from "react";
import { MeetingPreset } from "@/lib/member-storage";
import styles from "./PresetGrid.module.css";

interface PresetGridProps {
    presets: MeetingPreset[];
    selectedPreset: MeetingPreset | null;
    isAdhocMode?: boolean;
    onSelect: (preset: MeetingPreset | null) => void;
    onAdhoc?: () => void;
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

export default function PresetGrid({ presets, selectedPreset, isAdhocMode, onSelect, onAdhoc }: PresetGridProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setSearch("");
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [isOpen]);

    if (presets.length === 0) return null;

    const filtered = search.trim()
        ? presets.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase()))
        : presets;

    const handleSelect = (preset: MeetingPreset | null) => {
        onSelect(preset);
        setIsOpen(false);
        setSearch("");
    };

    return (
        <div className={styles.container} ref={containerRef}>
            <button
                className={`${styles.selector} ${selectedPreset ? styles.selectorActive : ""}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                {selectedPreset ? (
                    <div className={styles.selectedInfo}>
                        <span className={styles.selectedName}>{selectedPreset.name}</span>
                        <span className={styles.selectedMeta}>
                            <span style={{ color: MODE_COLORS[selectedPreset.mode] }}>
                                {MODE_LABELS[selectedPreset.mode]}
                            </span>
                            <span className={styles.dot} />
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ verticalAlign: "-1px" }}>
                                <path d="M8 8a3 3 0 100-6 3 3 0 000 6zM2 14a6 6 0 0112 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                            </svg>
                            {" "}{selectedPreset.memberIds?.length || 0}名
                        </span>
                    </div>
                ) : isAdhocMode ? (
                    <span className={styles.selectedName}>スポット会議</span>
                ) : (
                    <span className={styles.placeholder}>今日はどの会議ですか？</span>
                )}
                <svg
                    className={styles.chevron}
                    width="14" height="14" viewBox="0 0 16 16" fill="none"
                    style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                >
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {isOpen && (
                <div className={styles.dropdown}>
                    {presets.length >= 5 && (
                        <input
                            className={styles.search}
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="検索..."
                            autoFocus
                        />
                    )}
                    <div className={styles.list}>
                        {filtered.map(preset => {
                            const isSelected = selectedPreset?.id === preset.id;
                            return (
                                <button
                                    key={preset.id}
                                    className={`${styles.item} ${isSelected ? styles.itemSelected : ""}`}
                                    onClick={() => handleSelect(isSelected ? null : preset)}
                                >
                                    <span className={styles.itemName}>{preset.name}</span>
                                    <span className={styles.itemMeta}>
                                        <span style={{ color: MODE_COLORS[preset.mode] }}>
                                            {MODE_LABELS[preset.mode]}
                                        </span>
                                        <span className={styles.dot} />
                                        {preset.memberIds?.length || 0}名
                                    </span>
                                    {isSelected && (
                                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={styles.checkIcon}>
                                            <path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                </button>
                            );
                        })}
                        {filtered.length === 0 && (
                            <div className={styles.noResults}>一致するプリセットがありません</div>
                        )}
                    </div>
                    <button
                        className={`${styles.adhocOption} ${isAdhocMode && !selectedPreset ? styles.adhocOptionActive : ""}`}
                        onClick={() => { setIsOpen(false); setSearch(""); onAdhoc?.(); }}
                    >
                        スポット会議
                        <span className={styles.adhocHint}>プリセット未登録の会議</span>
                    </button>
                    {selectedPreset && (
                        <button className={styles.clearOption} onClick={() => handleSelect(null)}>
                            選択解除
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
