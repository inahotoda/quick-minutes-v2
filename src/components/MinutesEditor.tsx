"use client";

import { useState, useEffect } from "react";
import { MeetingMode } from "@/types";
import styles from "./MinutesEditor.module.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MinutesEditorProps {
    content: string;
    mode: MeetingMode;
    onChange: (content: string) => void;
    onSave: () => void;
    onSendEmail?: () => void;
    onDownloadAudio?: () => void;
    onRegenerate?: (feedback?: string) => void;
    onEditingChange?: (isEditing: boolean) => void;
    isSaving: boolean;
    isSaved: boolean;
    isSendingEmail?: boolean;
    isRegenerating?: boolean;
    modelVersion?: string;
    isTrialMode?: boolean;
    isPdfReady?: boolean;
}

export default function MinutesEditor({
    content,
    mode,
    onChange,
    onSave,
    onSendEmail,
    onDownloadAudio,
    onRegenerate,
    onEditingChange,
    isSaving,
    isSaved,
    isSendingEmail = false,
    isRegenerating = false,
    modelVersion,
    isTrialMode = false,
    isPdfReady = true,
}: MinutesEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedback, setFeedback] = useState("");
    const [countdown, setCountdown] = useState(120); // 2分 = 120秒

    // 再生成中のカウントダウン
    useEffect(() => {
        if (isRegenerating) {
            setCountdown(120);
            const timer = setInterval(() => {
                setCountdown((prev) => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
            return () => clearInterval(timer);
        }
    }, [isRegenerating]);

    const formatCountdown = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(content);
            alert("✓ クリップボードにコピーしました");
        } catch (error) {
            console.error("Copy failed:", error);
        }
    };

    const handleRegenerate = () => {
        if (onRegenerate) {
            onRegenerate();
        }
    };

    const handleRegenerateWithFeedback = () => {
        if (onRegenerate && feedback.trim()) {
            onRegenerate(feedback.trim());
            setFeedback("");
            setShowFeedback(false);
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
                        className={`${styles.actionButton} ${isEditing ? styles.actionButtonDone : ''}`}
                        onClick={() => {
                            const newIsEditing = !isEditing;
                            if (!newIsEditing) {
                                // iOS Safari ズームリセット:
                                // textareaをblurした後、viewport meta tagで強制リセット
                                const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
                                if (textarea) {
                                    textarea.style.fontSize = '16px';
                                    textarea.blur();
                                }
                                const viewportMeta = document.querySelector('meta[name="viewport"]');
                                if (viewportMeta) {
                                    const original = viewportMeta.getAttribute('content') || '';
                                    viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
                                    setTimeout(() => {
                                        viewportMeta.setAttribute('content', original);
                                        setIsEditing(false);
                                        onEditingChange?.(false);
                                    }, 200);
                                    return;
                                }
                            }
                            setIsEditing(newIsEditing);
                            onEditingChange?.(newIsEditing);
                        }}
                    >
                        {isEditing ? "✅ 完了" : "✏️ 編集"}
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
                        autoFocus
                    />
                ) : (
                    <div className={styles.preview} data-minutes-preview>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {content}
                        </ReactMarkdown>
                    </div>
                )}
            </div>

            {/* 再生成セクション */}
            {onRegenerate && (
                <div className={styles.regenerateSection}>
                    <div className={styles.regenerateButtons}>
                        <button
                            className={styles.regenerateButton}
                            onClick={handleRegenerate}
                            disabled={isRegenerating || isSaving}
                        >
                            {isRegenerating ? `⏳ 再生成中... ${formatCountdown(countdown)}` : "🔄 再生成"}
                        </button>
                        <button
                            className={styles.feedbackToggle}
                            onClick={() => setShowFeedback(!showFeedback)}
                            disabled={isRegenerating || isSaving}
                        >
                            {showFeedback ? "▲" : "▼"} 修正指示
                        </button>
                    </div>
                    {showFeedback && (
                        <div className={styles.feedbackContainer}>
                            <textarea
                                className={styles.feedbackInput}
                                placeholder="例: アクションアイテムを追加してください、参加者の名前を正確に..."
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                rows={2}
                            />
                            <button
                                className={styles.feedbackSubmit}
                                onClick={handleRegenerateWithFeedback}
                                disabled={!feedback.trim() || isRegenerating || isSaving}
                            >
                                ✨ 修正して再生成
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div className={styles.footer}>
                <button
                    className={`${styles.saveButton} ${(isSaved && !isTrialMode) ? styles.saveButtonSaved : ''}`}
                    onClick={onSave}
                    disabled={isSaving || isSendingEmail || (!isTrialMode && isSaved) || isRegenerating || isEditing || (isTrialMode && !isPdfReady)}
                >
                    {isSaving ? "保存中..." : (!isTrialMode && isSaved) ? "✅ 保存済み" : isEditing ? "✏️ 編集を完了してください" : (isTrialMode && !isPdfReady) ? "⏳ PDF準備中..." : isTrialMode ? "📄 PDFに保存" : "🚀 ドライブに保存"}
                </button>

                <div className={styles.footerSubActions}>
                    {onSendEmail && (
                        <button
                            className={`${styles.emailButton} ${isTrialMode ? styles.emailButtonDisabled : ''}`}
                            onClick={isTrialMode ? undefined : onSendEmail}
                            disabled={isTrialMode || isSaving || isSendingEmail || isRegenerating}
                            title={isTrialMode ? "モニター版では現在利用できません" : undefined}
                        >
                            {isSendingEmail ? "送信中..." : isTrialMode ? "✉️ メール送信（準備中）" : "✉️ メール送信"}
                        </button>
                    )}
                    {onDownloadAudio && (
                        <button
                            className={styles.downloadButtonFooter}
                            onClick={onDownloadAudio}
                            disabled={isSaving || isSendingEmail || isRegenerating}
                        >
                            ⬇️ 音声ダウンロード
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

