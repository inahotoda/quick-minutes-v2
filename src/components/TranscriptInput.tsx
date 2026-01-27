"use client";

import { useState } from "react";
import styles from "./TranscriptInput.module.css";

interface TranscriptInputProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export default function TranscriptInput({
    value,
    onChange,
    placeholder = "Google Meet等の文字起こしデータをここに貼り付け...",
}: TranscriptInputProps) {
    const [isFocused, setIsFocused] = useState(false);

    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            onChange(text);
        } catch (error) {
            console.error("Clipboard access denied:", error);
        }
    };

    const characterCount = value.length;

    return (
        <div className={`${styles.container} ${isFocused ? styles.focused : ""}`}>
            <div className={styles.header}>
                <span className={styles.label}>📝 文字起こし</span>
                <button className={styles.pasteButton} onClick={handlePaste}>
                    📋 ペースト
                </button>
            </div>
            <textarea
                className={styles.textarea}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={placeholder}
                rows={6}
            />
            <div className={styles.footer}>
                <span className={styles.charCount}>
                    {characterCount.toLocaleString()} 文字
                </span>
            </div>
        </div>
    );
}
