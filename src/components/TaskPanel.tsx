"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import styles from "./TaskPanel.module.css";
import { ExtractedTask, TaskStatus } from "@/types";

interface MemberInfo {
    name: string;
    email?: string | null;
    nameVariants?: string[];
}

interface TaskPanelProps {
    tasks: ExtractedTask[];
    isLoading: boolean;
    isDeliveryEnabled: boolean;
    accessToken?: string;
    summary?: {
        total: number;
        by_assignee: Record<string, number>;
    };
    onTasksUpdate?: (tasks: ExtractedTask[]) => void;
    participants?: string[];
    memberInfos?: MemberInfo[]; // メンバープロファイル（メール解決用）
}

const PRIORITY_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    critical: { label: "緊急", color: "#dc2626", bg: "#fef2f2" },
    high: { label: "高", color: "#ea580c", bg: "#fff7ed" },
    medium: { label: "中", color: "#2563eb", bg: "#eff6ff" },
    low: { label: "低", color: "#6b7280", bg: "#f9fafb" },
};

const PRIORITY_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "critical", label: "緊急" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];

function getConfidenceStyle(confidence: number): { color: string; label: string } {
    if (confidence >= 0.8) return { color: "#16a34a", label: "高確度" };
    if (confidence >= 0.5) return { color: "#ca8a04", label: "要確認" };
    return { color: "#dc2626", label: "低確度" };
}

function ChannelBadge({ type }: { type: string }) {
    const isCalendar = type === "google_calendar";
    return (
        <span className={styles.channelBadge} data-channel={isCalendar ? "calendar" : "chat"}>
            {isCalendar ? "📅 Calendar" : "💬 Chat"}
        </span>
    );
}

export default function TaskPanel({
    tasks,
    isLoading,
    isDeliveryEnabled,
    accessToken,
    summary,
    onTasksUpdate,
    participants,
    memberInfos = [],
}: TaskPanelProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<Partial<ExtractedTask>>({});
    const [isDelivering, setIsDelivering] = useState(false);
    const [deliveryMessage, setDeliveryMessage] = useState<string | null>(null);
    const [deliveryLinks, setDeliveryLinks] = useState<Map<string, string>>(new Map());
    const autoApprovedRef = useRef(false);

    // 高 confidence タスクの自動承認（初回のみ）
    useEffect(() => {
        if (autoApprovedRef.current || isLoading || tasks.length === 0 || !onTasksUpdate) return;

        const pendingTasks = tasks.filter(t => t.status === "pending");
        const highConfidenceTasks = pendingTasks.filter(t => t.assignee_confidence >= 0.8);

        if (highConfidenceTasks.length > 0) {
            autoApprovedRef.current = true;
            const updatedTasks = tasks.map(t => {
                if (t.status === "pending" && t.assignee_confidence >= 0.8) {
                    // サーバーにも通知（fire-and-forget）
                    fetch("/api/tasks/update", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ taskId: t.id, updates: { status: "approved" } }),
                    }).catch(console.error);
                    return { ...t, status: "approved" as TaskStatus };
                }
                return t;
            });
            onTasksUpdate(updatedTasks);
        }
    }, [isLoading, tasks, onTasksUpdate]);

    const approvedCount = tasks.filter(t => t.status === "approved" || t.status === "edited").length;
    const deliverableCount = tasks.filter(
        t => (t.status === "approved" || t.status === "edited") && t.deadline_date
    ).length;

    // タスクのステータス更新（サーバー同期）
    const updateTaskStatus = useCallback(async (taskId: string, status: TaskStatus, updates?: Partial<ExtractedTask>) => {
        try {
            await fetch("/api/tasks/update", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    taskId,
                    updates: { status, ...updates },
                }),
            });

            // ローカルの state を更新
            if (onTasksUpdate) {
                const updatedTasks = tasks.map(t =>
                    t.id === taskId ? { ...t, status, ...updates } : t
                );
                onTasksUpdate(updatedTasks);
            }
        } catch (err) {
            console.error("Task update failed:", err);
        }
    }, [tasks, onTasksUpdate]);

    // 編集開始
    const startEditing = (task: ExtractedTask) => {
        setEditingTaskId(task.id);
        setEditValues({
            assignee: task.assignee,
            action_summary: task.action_summary,
            deadline_date: task.deadline_date,
            priority: task.priority,
        });
    };

    // 編集保存
    const saveEditing = async () => {
        if (!editingTaskId) return;
        await updateTaskStatus(editingTaskId, "edited", editValues);
        setEditingTaskId(null);
        setEditValues({});
    };

    // 一括承認
    const approveAll = async () => {
        const pendingTasks = tasks.filter(t => t.status === "pending");
        for (const task of pendingTasks) {
            await updateTaskStatus(task.id, "approved");
        }
    };

    // 担当者名からメールアドレスを解決
    const resolveAssigneeEmail = useCallback((assignee: string | null): string | undefined => {
        if (!assignee || memberInfos.length === 0) return undefined;
        const member = memberInfos.find(m =>
            m.name === assignee ||
            m.nameVariants?.includes(assignee)
        );
        return member?.email || undefined;
    }, [memberInfos]);

    // Calendar 配信
    const handleDeliver = useCallback(async () => {
        if (!accessToken || !isDeliveryEnabled) return;

        const deliverableTasks = tasks.filter(
            t => (t.status === "approved" || t.status === "edited") && t.deadline_date
        );

        if (deliverableTasks.length === 0) return;

        setIsDelivering(true);
        setDeliveryMessage(null);

        try {
            // クライアントサイドで Calendar API を直接呼ぶ
            const { createCalendarEvent } = await import("@/lib/calendar-client");

            const deliveryResults: Array<{ taskId: string; channel: string; success: boolean; eventId?: string; htmlLink?: string; error?: string }> = [];

            for (const task of deliverableTasks) {
                const description = [
                    task.action_summary,
                    task.action_context ? `\n議題: ${task.action_context}` : "",
                    task.assignee ? `\n担当: ${task.assignee}` : "",
                ].join("");

                const attendeeEmail = resolveAssigneeEmail(task.assignee);
                const result = await createCalendarEvent(accessToken, {
                    summary: `[タスク] ${task.action_summary}`,
                    description,
                    date: task.deadline_date!,
                    attendeeEmail,
                });

                deliveryResults.push({
                    taskId: task.id,
                    channel: "google_calendar",
                    ...result,
                });
            }

            // サーバーに配信ログを記録
            await fetch("/api/tasks/deliver", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    taskIds: deliverableTasks.map(t => t.id),
                    deliveryResults,
                }),
            });

            // 配信リンクを保存
            const newLinks = new Map(deliveryLinks);
            deliveryResults.forEach(r => {
                if (r.success && r.htmlLink) {
                    newLinks.set(r.taskId, r.htmlLink);
                }
            });
            setDeliveryLinks(newLinks);

            // ローカル state 更新
            if (onTasksUpdate) {
                const updatedTasks = tasks.map(t => {
                    const result = deliveryResults.find(r => r.taskId === t.id);
                    if (result?.success) {
                        return { ...t, status: "delivered" as TaskStatus };
                    }
                    return t;
                });
                onTasksUpdate(updatedTasks);
            }

            const successCount = deliveryResults.filter(r => r.success).length;
            const failCount = deliveryResults.filter(r => !r.success).length;

            if (failCount === 0) {
                setDeliveryMessage(`✅ ${successCount}件のタスクを Google Calendar に配信しました`);
            } else {
                setDeliveryMessage(`⚠️ ${successCount}件成功、${failCount}件失敗`);
            }
        } catch (err) {
            console.error("Delivery failed:", err);
            setDeliveryMessage("配信に失敗しました。再ログインが必要な可能性があります。");
        } finally {
            setIsDelivering(false);
        }
    }, [tasks, accessToken, isDeliveryEnabled, onTasksUpdate]);

    if (!isLoading && tasks.length === 0) {
        return null;
    }

    return (
        <div className={styles.container}>
            <div className={styles.header} onClick={() => setIsCollapsed(!isCollapsed)}>
                <div className={styles.titleWrapper}>
                    <span className={styles.title}>
                        Next Actions
                        {!isLoading && tasks.length > 0 && (
                            <span className={styles.count}>{tasks.length}件</span>
                        )}
                    </span>
                    {isLoading && <span className={styles.loadingLabel}>タスク抽出中...</span>}
                </div>
                <button className={styles.collapseBtn} aria-label={isCollapsed ? "展開" : "折りたたみ"}>
                    {isCollapsed ? "▼" : "▲"}
                </button>
            </div>

            {!isCollapsed && (
                <div className={styles.body}>
                    {isLoading && (
                        <div className={styles.loadingState}>
                            <div className={styles.loadingAnimation}>
                                <div className={styles.spinner} />
                                <div className={styles.loadingDots}>
                                    <span className={styles.dot} />
                                    <span className={styles.dot} />
                                    <span className={styles.dot} />
                                </div>
                            </div>
                            <div className={styles.loadingText}>
                                <span className={styles.loadingTitle}>タスクを抽出中</span>
                                <span className={styles.loadingSubtext}>議事録からネクストアクションを検出しています...</span>
                            </div>
                        </div>
                    )}

                    {!isLoading && tasks.length > 0 && (
                        <>
                            {summary && Object.keys(summary.by_assignee).length > 0 && (
                                <div className={styles.summaryBar}>
                                    {Object.entries(summary.by_assignee).map(([name, count]) => (
                                        <span key={name} className={styles.assigneeSummary}>
                                            {name || "未定"}: {count}件
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* 一括アクションバー */}
                            {isDeliveryEnabled && (
                                <div className={styles.bulkActions}>
                                    <button
                                        className={styles.approveAllBtn}
                                        onClick={approveAll}
                                        disabled={tasks.every(t => t.status !== "pending")}
                                    >
                                        全て承認
                                    </button>
                                    <button
                                        className={styles.deliverBtn}
                                        onClick={handleDeliver}
                                        disabled={isDelivering || deliverableCount === 0}
                                    >
                                        {isDelivering
                                            ? "配信中..."
                                            : `📅 Calendar に配信（${deliverableCount}件）`}
                                    </button>
                                </div>
                            )}

                            {deliveryMessage && (
                                <div className={styles.deliveryMessage}>
                                    {deliveryMessage}
                                </div>
                            )}

                            <div className={styles.taskList}>
                                {tasks.map((task) => {
                                    const priority = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.medium;
                                    const confidence = getConfidenceStyle(task.assignee_confidence);
                                    const isEditing = editingTaskId === task.id;
                                    const isDecided = task.status !== "pending";

                                    return (
                                        <div
                                            key={task.id}
                                            className={`${styles.taskCard} ${isDecided ? styles[`taskCard_${task.status}`] : ""}`}
                                        >
                                            <div className={styles.taskHeader}>
                                                {isEditing ? (
                                                    <select
                                                        className={styles.prioritySelect}
                                                        value={editValues.priority || task.priority}
                                                        onChange={e => setEditValues(v => ({ ...v, priority: e.target.value as any }))}
                                                    >
                                                        {PRIORITY_OPTIONS.map(o => (
                                                            <option key={o.value} value={o.value}>{o.label}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <span
                                                        className={styles.priorityBadge}
                                                        style={{ color: priority.color, background: priority.bg }}
                                                    >
                                                        {priority.label}
                                                    </span>
                                                )}

                                                <div className={styles.headerRight}>
                                                    {task.status === "delivered" && (
                                                        <span className={styles.deliveredBadge}>
                                                            配信済
                                                            {deliveryLinks.get(task.id) && (
                                                                <a
                                                                    href={deliveryLinks.get(task.id)}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className={styles.calendarLink}
                                                                    onClick={e => e.stopPropagation()}
                                                                >
                                                                    📅 開く
                                                                </a>
                                                            )}
                                                        </span>
                                                    )}
                                                    {task.status === "skipped" && (
                                                        <span className={styles.skippedBadge}>スキップ</span>
                                                    )}
                                                    <div className={styles.channels}>
                                                        {task.recommended_channels.map((ch, i) => (
                                                            <ChannelBadge key={i} type={typeof ch === "string" ? ch : ch.type} />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className={styles.taskBody}>
                                                {isEditing ? (
                                                    <input
                                                        className={styles.editInput}
                                                        value={editValues.action_summary ?? task.action_summary}
                                                        onChange={e => setEditValues(v => ({ ...v, action_summary: e.target.value }))}
                                                    />
                                                ) : (
                                                    <p className={styles.actionSummary}>{task.action_summary}</p>
                                                )}
                                                {!isEditing && task.action_context && (
                                                    <p className={styles.actionContext}>{task.action_context}</p>
                                                )}
                                            </div>

                                            <div className={styles.taskMeta}>
                                                <div className={styles.metaItem}>
                                                    <span className={styles.metaLabel}>担当</span>
                                                    {isEditing ? (
                                                        participants && participants.length > 0 ? (
                                                            <select
                                                                className={styles.editSelect}
                                                                value={editValues.assignee ?? task.assignee ?? ""}
                                                                onChange={e => setEditValues(v => ({ ...v, assignee: e.target.value || null }))}
                                                            >
                                                                <option value="">未定</option>
                                                                {participants.map(p => (
                                                                    <option key={p} value={p}>{p}</option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <input
                                                                className={styles.editInputSmall}
                                                                value={editValues.assignee ?? task.assignee ?? ""}
                                                                onChange={e => setEditValues(v => ({ ...v, assignee: e.target.value || null }))}
                                                                placeholder="担当者名"
                                                            />
                                                        )
                                                    ) : (
                                                        <span className={styles.metaValue}>
                                                            {task.assignee || "未定"}
                                                            <span
                                                                className={styles.confidenceDot}
                                                                style={{ background: confidence.color }}
                                                                title={confidence.label}
                                                            />
                                                        </span>
                                                    )}
                                                </div>
                                                <div className={styles.metaItem}>
                                                    <span className={styles.metaLabel}>期限</span>
                                                    {isEditing ? (
                                                        <input
                                                            type="date"
                                                            className={styles.editInputSmall}
                                                            value={editValues.deadline_date ?? task.deadline_date ?? ""}
                                                            onChange={e => setEditValues(v => ({ ...v, deadline_date: e.target.value || null }))}
                                                        />
                                                    ) : (
                                                        <span className={styles.metaValue}>
                                                            {task.deadline_date || task.deadline_raw || "なし"}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* アクションボタン */}
                                            {isDeliveryEnabled && !isDecided && (
                                                <div className={styles.taskActions}>
                                                    {isEditing ? (
                                                        <>
                                                            <button className={styles.saveBtn} onClick={saveEditing}>保存</button>
                                                            <button className={styles.cancelBtn} onClick={() => { setEditingTaskId(null); setEditValues({}); }}>キャンセル</button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                className={styles.approveBtn}
                                                                onClick={() => updateTaskStatus(task.id, "approved")}
                                                            >
                                                                承認
                                                            </button>
                                                            <button
                                                                className={styles.editBtn}
                                                                onClick={() => startEditing(task)}
                                                            >
                                                                編集
                                                            </button>
                                                            <button
                                                                className={styles.skipBtn}
                                                                onClick={() => updateTaskStatus(task.id, "skipped")}
                                                            >
                                                                スキップ
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}

                                            {!isDeliveryEnabled && (
                                                <div className={styles.lockedOverlay}>
                                                    <span>配信機能は Pro プランで利用可能</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
