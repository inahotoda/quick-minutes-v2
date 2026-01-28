"use client";

import { useState } from "react";
import { MeetingMode } from "@/types";
import styles from "./MinutesEditor.module.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Markdownからプレーンテキストを抽出（Gmail用など）
const stripMarkdown = (markdown: string) => {
    return markdown
        .replace(/^#+\s+/gm, "") // 見出し
        .replace(/\*\*(.*?)\*\*/g, "$1") // 太字
        .replace(/\*(.*?)\*/g, "$1") // 斜体
        .replace(/`{1,3}[\s\S]*?`{1,3}/g, "") // コード (sフラグの代わり)
        .replace(/\[(.*?)\]\(.*?\)/g, "$1") // リンク
        .replace(/- \[( |x)\] /g, "- ") // チェックボックス
        .replace(/\|/g, " ") // テーブルの罫線
        .trim();
};

// コンテンツの冒頭から概要（タイトル、日付、参加者）を抽出
const extractSummary = (content: string) => {
    const lines = content.split("\n");
    let title = "";
    let date = "";
    let attendants = "";

    for (const line of lines) {
        if (!title && (line.startsWith("# ") || line.match(/^【.*】$/))) title = line.replace("# ", "").trim();
        if (!date && (line.includes("日付") || line.includes("Date"))) date = line.split(":")[1]?.trim() || line.trim();
        if (!attendants && (line.includes("参加者") || line.includes("出席者") || line.includes("Attendants"))) attendants = line.split(":")[1]?.trim() || line.trim();
    }

    return { title, date, attendants };
};

interface MinutesEditorProps {
    content: string;
    mode: MeetingMode;
    onChange: (content: string) => void;
    onSave: () => void;
    onSendEmail?: (plainText: string) => void;
    onDownloadAudio?: () => void;
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
    onDownloadAudio,
    isSaving,
    isSendingEmail = false,
    modelVersion,
}: MinutesEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const summary = extractSummary(content);

    const handleEmailClick = () => {
        if (!onSendEmail) return;
        // プレーンテキストに変換して送信
        const plainText = stripMarkdown(content);
        onSendEmail(plainText);
    };

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
                    <h2 className={styles.title}>
                        📋 稲穂議事録
                        <span className={styles.envBadge}>STAGING</span>
                    </h2>
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

            {/* 会議概要ヘッダー（固定） */}
            {!isEditing && (summary.title || summary.date) && (
                <div className={styles.summaryHeader}>
                    <div className={styles.summaryItem}>
                        <span className={styles.summaryLabel}>議題:</span>
                        <span className={styles.summaryValue}>{summary.title || "未設定"}</span>
                    </div>
                    <div className={styles.summaryRow}>
                        <div className={styles.summaryItem}>
                            <span className={styles.summaryLabel}>日時:</span>
                            <span className={styles.summaryValue}>{summary.date || "未設定"}</span>
                        </div>
                        <div className={styles.summaryItem}>
                            <span className={styles.summaryLabel}>参加者:</span>
                            <span className={styles.summaryValue}>{summary.attendants || "未設定"}</span>
                        </div>
                    </div>
                </div>
            )}

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
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {content}
                        </ReactMarkdown>
                    </div>
                )}
            </div>

            <div className={styles.footer}>
                <button
                    className={styles.saveButton}
                    onClick={onSave}
                    disabled={isSaving || isSendingEmail}
                >
                    {isSaving ? "保存中..." : "🚀 ドライブに直保存(V5)"}
                </button>

                <div className={styles.footerSubActions}>
                    {onSendEmail && (
                        <button
                            className={styles.emailButton}
                            onClick={handleEmailClick}
                            disabled={isSaving || isSendingEmail}
                        >
                            {isSendingEmail ? "送信中..." : "✉️ メール送信"}
                        </button>
                    )}
                    {onDownloadAudio && (
                        <button
                            className={styles.downloadButtonFooter}
                            onClick={onDownloadAudio}
                            disabled={isSaving || isSendingEmail}
                        >
                            ⬇️ 音声ダウンロード
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
