"use client";

import { useState, useEffect, useRef } from "react";
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
    /** Phase 2 (Claude Opus 4.7) refinement in progress */
    isRefining?: boolean;
    /** Phase 2 has finished at least once */
    refineCompleted?: boolean;
    /** Whether a draft (Phase 1) version exists and differs from current */
    hasDraftAvailable?: boolean;
    /** User toggled to draft view */
    showingDraft?: boolean;
    onToggleDraft?: () => void;
    /** When false, the "議事録に質問する" UI is hidden (feature disabled for this tenant) */
    askEnabled?: boolean;
    modelVersion?: string;
    isTrialMode?: boolean;
    isPdfReady?: boolean;
}

interface AskMessage {
    role: "user" | "assistant";
    content: string;
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
    isRefining = false,
    refineCompleted = false,
    hasDraftAvailable = false,
    showingDraft = false,
    onToggleDraft,
    askEnabled = true,
    modelVersion,
    isTrialMode = false,
    isPdfReady = true,
}: MinutesEditorProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedback, setFeedback] = useState("");
    const [countdown, setCountdown] = useState(120);

    // Ask Claude state
    const [showAsk, setShowAsk] = useState(false);
    const [question, setQuestion] = useState("");
    const [askHistory, setAskHistory] = useState<AskMessage[]>([]);
    const [isAsking, setIsAsking] = useState(false);
    const askEndRef = useRef<HTMLDivElement>(null);

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

    useEffect(() => {
        if (askEndRef.current) {
            askEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [askHistory, isAsking]);

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
        if (onRegenerate) onRegenerate();
    };

    const handleRegenerateWithFeedback = () => {
        if (onRegenerate && feedback.trim()) {
            onRegenerate(feedback.trim());
            setFeedback("");
            setShowFeedback(false);
        }
    };

    const handleAsk = async () => {
        const q = question.trim();
        if (!q || isAsking) return;

        setIsAsking(true);
        const newHistory: AskMessage[] = [...askHistory, { role: "user", content: q }];
        setAskHistory(newHistory);
        setQuestion("");

        try {
            const res = await fetch("/api/ask", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    minutesMarkdown: content,
                    question: q,
                    history: askHistory,
                }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "応答の取得に失敗しました");
            }

            const reader = res.body?.getReader();
            if (!reader) throw new Error("ストリームを読み取れません");

            const decoder = new TextDecoder();
            let answer = "";
            // Push placeholder assistant message we'll update as it streams in
            setAskHistory((prev) => [...prev, { role: "assistant", content: "" }]);
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                answer += decoder.decode(value, { stream: true });
                setAskHistory((prev) => {
                    const next = [...prev];
                    next[next.length - 1] = { role: "assistant", content: answer };
                    return next;
                });
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : "エラーが発生しました";
            setAskHistory((prev) => [
                ...prev,
                { role: "assistant", content: `❌ ${msg}` },
            ]);
        } finally {
            setIsAsking(false);
        }
    };

    const handleAskKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isAsking) {
            e.preventDefault();
            handleAsk();
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.titleWrapper}>
                    <h2 className={styles.title}>📋 議事録{showingDraft ? "（下書き）" : ""}</h2>
                    {modelVersion && <span className={styles.modelVersion}>{modelVersion}</span>}
                </div>
                <div className={styles.actions}>
                    <button
                        className={`${styles.actionButton} ${isEditing ? styles.actionButtonDone : ''}`}
                        onClick={() => {
                            const newIsEditing = !isEditing;
                            if (!newIsEditing) {
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
                    {hasDraftAvailable && onToggleDraft && (
                        <button
                            className={styles.actionButton}
                            onClick={onToggleDraft}
                            title={showingDraft ? "推敲版に戻す" : "Geminiの下書きを表示"}
                        >
                            {showingDraft ? "✨ 推敲版" : "📝 下書き"}
                        </button>
                    )}
                </div>
            </div>

            {/* Phase 2 progress banner */}
            {isRefining && (
                <div className={styles.refineBanner}>
                    <span className={styles.refineSpinner} />
                    <span>✨ Claudeが推敲中...（30〜60秒ほどかかります。下書きは表示されています）</span>
                </div>
            )}
            {!isRefining && refineCompleted && !showingDraft && (
                <div className={styles.refineBannerDone}>
                    ✓ 推敲完了 — Claude Opus 4.7 が品質を整えました
                </div>
            )}

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

            {/* Ask Claude section */}
            {askEnabled && !showingDraft && content.trim().length > 50 && (
                <div className={styles.askSection}>
                    <button
                        className={styles.askToggle}
                        onClick={() => setShowAsk(v => !v)}
                        disabled={isRefining}
                    >
                        {showAsk ? "▲" : "💬"} 議事録に質問する
                        {isRefining && <span style={{ marginLeft: 8, fontSize: "0.75rem", opacity: 0.7 }}>（推敲完了後に有効）</span>}
                    </button>
                    {showAsk && (
                        <div className={styles.askContainer}>
                            {askHistory.length === 0 && (
                                <div className={styles.askHint}>
                                    例: 「3行で要約して」「田中さんのアクションを抜き出して」「先方向けのメール文面にして」
                                </div>
                            )}
                            <div className={styles.askMessages}>
                                {askHistory.map((m, i) => (
                                    <div
                                        key={i}
                                        className={m.role === "user" ? styles.askMessageUser : styles.askMessageAssistant}
                                    >
                                        <div className={styles.askMessageRole}>
                                            {m.role === "user" ? "🙋 あなた" : "🤖 Claude"}
                                        </div>
                                        <div className={styles.askMessageContent}>
                                            {m.role === "assistant" ? (
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                                            ) : (
                                                m.content
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {isAsking && askHistory.length > 0 && askHistory[askHistory.length - 1].role === "user" && (
                                    <div className={styles.askMessageAssistant}>
                                        <div className={styles.askMessageRole}>🤖 Claude</div>
                                        <div className={styles.askMessageContent}>
                                            <span className={styles.refineSpinner} /> 考えています...
                                        </div>
                                    </div>
                                )}
                                <div ref={askEndRef} />
                            </div>
                            <div className={styles.askInputRow}>
                                <textarea
                                    className={styles.askInput}
                                    value={question}
                                    onChange={(e) => setQuestion(e.target.value)}
                                    onKeyDown={handleAskKeyDown}
                                    placeholder="質問を入力（⌘/Ctrl + Enter で送信）"
                                    rows={2}
                                    disabled={isAsking || isRefining}
                                />
                                <button
                                    className={styles.askSubmit}
                                    onClick={handleAsk}
                                    disabled={!question.trim() || isAsking || isRefining}
                                >
                                    {isAsking ? "..." : "送信"}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {onRegenerate && (
                <div className={styles.regenerateSection}>
                    <div className={styles.regenerateButtons}>
                        <button
                            className={styles.regenerateButton}
                            onClick={handleRegenerate}
                            disabled={isRegenerating || isSaving || isRefining}
                        >
                            {isRegenerating ? `⏳ 再生成中... ${formatCountdown(countdown)}` : "🔄 再生成"}
                        </button>
                        <button
                            className={styles.feedbackToggle}
                            onClick={() => setShowFeedback(!showFeedback)}
                            disabled={isRegenerating || isSaving || isRefining}
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
                                disabled={!feedback.trim() || isRegenerating || isSaving || isRefining}
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
                    disabled={isSaving || isSendingEmail || (!isTrialMode && isSaved) || isRegenerating || isRefining || isEditing || (isTrialMode && !isPdfReady)}
                >
                    {isSaving ? "保存中..." : (!isTrialMode && isSaved) ? "✅ 保存済み" : isEditing ? "✏️ 編集を完了してください" : isRefining ? "✨ 推敲完了をお待ちください..." : (isTrialMode && !isPdfReady) ? "⏳ PDF準備中..." : isTrialMode ? "📄 PDFに保存" : "🚀 ドライブに保存"}
                </button>

                <div className={styles.footerSubActions}>
                    {onSendEmail && (
                        <button
                            className={`${styles.emailButton} ${isTrialMode ? styles.emailButtonDisabled : ''}`}
                            onClick={isTrialMode ? undefined : onSendEmail}
                            disabled={isTrialMode || isSaving || isSendingEmail || isRegenerating || isRefining}
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

            {/* unused — kept to suppress lint warning for prop */}
            {mode === "internal" && null}
        </div>
    );
}
