"use client";

import { useState } from "react";
import { MeetingMode } from "@/types";
import styles from "./MinutesEditor.module.css";

interface MinutesEditorProps {
    content: string;
    mode: MeetingMode;
    onChange: (content: string) => void;
    onSave: () => void;
    onSendEmail?: () => void;
    isSaving: boolean;
    isSendingEmail?: boolean;
    modelVersion?: string;
}

export default function MinutesEditor({
    content,
    mode,
    onChange,
    onSave,
    onSendEmail,
    isSaving,
    isSendingEmail = false,
    modelVersion,
}: MinutesEditorProps) {
    const [isEditing, setIsEditing] = useState(false);

    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(content);
            alert("✓ クリップボードにコピーしました");
        } catch (error) {
            console.error("Copy failed:", error);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.titleWrapper}>
                    <h2 className={styles.title}>📋 議事録</h2>
                    {modelVersion && <span className={styles.modelVersion}>{modelVersion}</span>}
                </div>
                <div className={styles.actions}>
                    <button
                        className={styles.actionButton}
                        onClick={() => setIsEditing(!isEditing)}
                    >
                        {isEditing ? "✓ 完了" : "✏️ 編集"}
                    </button>
                    <button className={styles.actionButton} onClick={copyToClipboard}>
                        📋 コピー
                    </button>
                </div>
            </div>

            <div className={styles.content}>
                {isEditing ? (
                    <textarea
                        className={styles.editor}
                        value={content}
                        onChange={(e) => onChange(e.target.value)}
                        rows={20}
                    />
                ) : (
                    <div className={styles.preview}>
                        <pre>{content}</pre>
                    </div>
                )}
            </div>

            <div className={styles.footer}>
                <button
                    className={styles.saveButton}
                    onClick={onSave}
                    disabled={isSaving}
                >
                    {isSaving ? "保存中..." : "💾 Google Driveに保存"}
                </button>
                {mode === "business" && onSendEmail && (
                    <button
                        className={styles.emailButton}
                        onClick={onSendEmail}
                        disabled={isSaving || isSendingEmail}
                    >
                        {isSendingEmail ? "送信中..." : "✉️ メール送信"}
                    </button>
                )}
            </div>
        </div>
    );
}
