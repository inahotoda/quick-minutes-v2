"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "../settings.module.css";

interface TenantDomain {
    id: string;
    tenant_id: string;
    domain: string;
    email: string | null;
    match_type: string;
    created_at: string;
}

interface Tenant {
    tenant_id: string;
    company_name: string;
    is_active: boolean;
    expires_at: string;
    created_at: string;
    domains: TenantDomain[];
}

export default function TenantsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // 新規登録フォーム
    const [input, setInput] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [days, setDays] = useState(30);
    const [saving, setSaving] = useState(false);

    // 既存テナントへのドメイン追加
    const [addingDomainFor, setAddingDomainFor] = useState<string | null>(null);
    const [newDomainInput, setNewDomainInput] = useState("");
    const [addingDomain, setAddingDomain] = useState(false);

    // 削除中
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [deletingDomainId, setDeletingDomainId] = useState<string | null>(null);

    // 期限延長中
    const [extendingId, setExtendingId] = useState<string | null>(null);

    useEffect(() => {
        fetchTenants();
    }, []);

    const fetchTenants = async () => {
        try {
            const res = await fetch("/api/admin/tenants");
            if (res.ok) {
                const data = await res.json();
                setTenants(data.tenants || []);
            } else if (res.status === 403) {
                setMessage({ type: "error", text: "管理者権限がありません" });
            }
        } catch (err) {
            console.error("Failed to fetch tenants:", err);
        } finally {
            setLoading(false);
        }
    };

    // 入力内容からマッチ方式を判定
    const getInputHint = (val: string) => {
        const trimmed = val.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("*@")) {
            return { type: "domain", label: `${trimmed.slice(2)} ドメインの全ユーザーを許可` };
        }
        if (trimmed.includes("@")) {
            return { type: "email", label: `${trimmed} のみ許可` };
        }
        return { type: "error", label: "「*@ドメイン」または「メールアドレス」形式で入力" };
    };

    const hint = getInputHint(input);
    const newDomainHint = getInputHint(newDomainInput);

    // 新規テナント作成
    const handleAdd = async () => {
        if (!input.trim() || !companyName.trim()) return;
        setSaving(true);
        setMessage(null);

        try {
            const res = await fetch("/api/admin/tenants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ input: input.trim(), companyName: companyName.trim(), days }),
            });

            const data = await res.json();

            if (res.ok) {
                setMessage({ type: "success", text: `${companyName} を登録しました` });
                setInput("");
                setCompanyName("");
                fetchTenants();
            } else {
                setMessage({ type: "error", text: data.error || "登録に失敗しました" });
            }
        } catch (err) {
            setMessage({ type: "error", text: "登録に失敗しました" });
        } finally {
            setSaving(false);
            setTimeout(() => setMessage(null), 4000);
        }
    };

    // 既存テナントへのドメイン追加
    const handleAddDomain = async (tenantId: string) => {
        if (!newDomainInput.trim()) return;
        setAddingDomain(true);
        setMessage(null);

        try {
            const res = await fetch("/api/admin/tenants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, input: newDomainInput.trim() }),
            });

            const data = await res.json();

            if (res.ok) {
                setMessage({ type: "success", text: "アドレスを追加しました" });
                setNewDomainInput("");
                setAddingDomainFor(null);
                fetchTenants();
            } else {
                setMessage({ type: "error", text: data.error || "追加に失敗しました" });
            }
        } catch (err) {
            setMessage({ type: "error", text: "追加に失敗しました" });
        } finally {
            setAddingDomain(false);
            setTimeout(() => setMessage(null), 4000);
        }
    };

    // テナント全体削除
    const handleDelete = async (tenantId: string, name: string) => {
        if (!confirm(`${name} を削除しますか？\n紐づくすべてのアドレス/ドメインも削除されます。`)) return;
        setDeletingId(tenantId);

        try {
            const res = await fetch("/api/admin/tenants", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId }),
            });

            if (res.ok) {
                setMessage({ type: "success", text: `${name} を削除しました` });
                fetchTenants();
            } else {
                setMessage({ type: "error", text: "削除に失敗しました" });
            }
        } catch (err) {
            setMessage({ type: "error", text: "削除に失敗しました" });
        } finally {
            setDeletingId(null);
            setTimeout(() => setMessage(null), 4000);
        }
    };

    // テナント有効期限の延長
    const handleExtend = async (tenantId: string, name: string) => {
        const input = prompt(`${name} の有効期限を何日延長しますか？\n(例: 30, 60, 90, 365)`, "30");
        if (input === null) return;
        const extendDays = parseInt(input, 10);
        if (!Number.isFinite(extendDays) || extendDays <= 0) {
            setMessage({ type: "error", text: "1以上の日数を入力してください" });
            setTimeout(() => setMessage(null), 4000);
            return;
        }

        setExtendingId(tenantId);
        setMessage(null);

        try {
            const res = await fetch("/api/admin/tenants", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tenantId, extendDays }),
            });

            const data = await res.json();

            if (res.ok) {
                setMessage({ type: "success", text: `${name} の有効期限を${extendDays}日延長しました` });
                fetchTenants();
            } else {
                setMessage({ type: "error", text: data.error || "延長に失敗しました" });
            }
        } catch (err) {
            setMessage({ type: "error", text: "延長に失敗しました" });
        } finally {
            setExtendingId(null);
            setTimeout(() => setMessage(null), 4000);
        }
    };

    // 個別ドメイン/メール削除
    const handleDeleteDomain = async (domainId: string, domainCount: number) => {
        if (domainCount <= 1) {
            setMessage({ type: "error", text: "最後のアドレスは削除できません。企業ごと削除してください。" });
            setTimeout(() => setMessage(null), 4000);
            return;
        }
        if (!confirm("このアドレスを削除しますか？")) return;
        setDeletingDomainId(domainId);

        try {
            const res = await fetch("/api/admin/tenants", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ domainId }),
            });

            if (res.ok) {
                setMessage({ type: "success", text: "アドレスを削除しました" });
                fetchTenants();
            } else {
                setMessage({ type: "error", text: "削除に失敗しました" });
            }
        } catch (err) {
            setMessage({ type: "error", text: "削除に失敗しました" });
        } finally {
            setDeletingDomainId(null);
            setTimeout(() => setMessage(null), 4000);
        }
    };

    const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();
    const daysLeft = (expiresAt: string) => {
        const diff = new Date(expiresAt).getTime() - Date.now();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>読み込み中...</p>
            </div>
        );
    }

    return (
        <div className={styles.main}>
            <header className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push("/settings")}>
                    ← 設定に戻る
                </button>
                <h1 className={styles.title}>モニター企業管理</h1>
                <div style={{ width: 80 }}></div>
            </header>

            <div className={styles.content}>
                {message && (
                    <div className={`${styles.alert} ${styles[message.type]}`}>
                        {message.type === "success" ? "✅" : "⚠️"} {message.text}
                    </div>
                )}

                {/* 登録フォーム */}
                <section className={styles.section}>
                    <h2>新規登録</h2>
                    <p className={styles.help}>
                        モニター版にアクセスできる企業・ユーザーを登録します。
                    </p>

                    <div className={styles.tenantForm}>
                        <div className={styles.tenantFormRow}>
                            <div className={styles.tenantFormField}>
                                <label className={styles.tenantLabel}>メールアドレス / ドメイン</label>
                                <input
                                    className={styles.tenantInput}
                                    type="text"
                                    placeholder="*@abc-corp.co.jp  or  tanaka@gmail.com"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                />
                                {hint && (
                                    <span className={`${styles.tenantHint} ${hint.type === "error" ? styles.tenantHintError : ""}`}>
                                        {hint.type === "domain" ? "🌐" : hint.type === "email" ? "✉️" : "⚠️"} {hint.label}
                                    </span>
                                )}
                            </div>

                            <div className={styles.tenantFormField}>
                                <label className={styles.tenantLabel}>企業名</label>
                                <input
                                    className={styles.tenantInput}
                                    type="text"
                                    placeholder="ABC商事株式会社"
                                    value={companyName}
                                    onChange={(e) => setCompanyName(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className={styles.tenantFormRow}>
                            <div className={styles.tenantFormField}>
                                <label className={styles.tenantLabel}>トライアル期間</label>
                                <select
                                    className={styles.tenantInput}
                                    value={days}
                                    onChange={(e) => setDays(Number(e.target.value))}
                                >
                                    <option value={7}>7日間</option>
                                    <option value={14}>14日間</option>
                                    <option value={30}>30日間</option>
                                    <option value={60}>60日間</option>
                                    <option value={90}>90日間</option>
                                    <option value={365}>1年間</option>
                                </select>
                            </div>
                            <div className={styles.tenantFormField} style={{ display: "flex", alignItems: "flex-end" }}>
                                <button
                                    className={styles.saveButton}
                                    onClick={handleAdd}
                                    disabled={saving || !input.trim() || !companyName.trim() || hint?.type === "error"}
                                    style={{ margin: 0 }}
                                >
                                    {saving ? "登録中..." : "🏢 企業を登録"}
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* テナント一覧 */}
                <section className={styles.section}>
                    <h2>登録済み企業 ({tenants.length}件)</h2>

                    {tenants.length === 0 ? (
                        <div className={styles.emptyState}>
                            まだ企業が登録されていません
                        </div>
                    ) : (
                        <div className={styles.tenantList}>
                            {tenants.map((t) => {
                                const expired = isExpired(t.expires_at);
                                const remaining = daysLeft(t.expires_at);
                                const isAddingHere = addingDomainFor === t.tenant_id;

                                return (
                                    <div
                                        key={t.tenant_id}
                                        className={`${styles.tenantCard} ${expired ? styles.tenantExpired : ""}`}
                                    >
                                        {/* ヘッダー: 企業名 + ステータス + 削除 */}
                                        <div className={styles.tenantCardMain}>
                                            <div className={styles.tenantCardInfo}>
                                                <span className={styles.tenantCompany}>{t.company_name}</span>
                                            </div>
                                            <div className={styles.tenantCardRight}>
                                                <span className={`${styles.tenantStatus} ${expired ? styles.tenantStatusExpired : styles.tenantStatusActive}`}>
                                                    {expired ? "期限切れ" : `残り${remaining}日`}
                                                </span>
                                                <button
                                                    className={styles.tenantExtendBtn}
                                                    onClick={() => handleExtend(t.tenant_id, t.company_name)}
                                                    disabled={extendingId === t.tenant_id}
                                                    title="有効期限を延長"
                                                >
                                                    {extendingId === t.tenant_id ? "..." : "期限延長"}
                                                </button>
                                                <button
                                                    className={styles.tenantDeleteBtn}
                                                    onClick={() => handleDelete(t.tenant_id, t.company_name)}
                                                    disabled={deletingId === t.tenant_id}
                                                >
                                                    {deletingId === t.tenant_id ? "..." : "削除"}
                                                </button>
                                            </div>
                                        </div>

                                        {/* ドメイン/メール一覧 */}
                                        <div className={styles.tenantDomainList}>
                                            {t.domains.map((d) => (
                                                <div key={d.id} className={styles.tenantDomainItem}>
                                                    <span className={styles.tenantDomainLabel}>
                                                        {d.match_type === "email"
                                                            ? `✉️ ${d.email}`
                                                            : `🌐 *@${d.domain}`}
                                                    </span>
                                                    <button
                                                        className={styles.tenantDomainDeleteBtn}
                                                        onClick={() => handleDeleteDomain(d.id, t.domains.length)}
                                                        disabled={deletingDomainId === d.id}
                                                        title={t.domains.length <= 1 ? "最後のアドレスは削除できません" : "削除"}
                                                    >
                                                        {deletingDomainId === d.id ? "..." : "×"}
                                                    </button>
                                                </div>
                                            ))}

                                            {/* ドメイン追加ボタン / フォーム */}
                                            {isAddingHere ? (
                                                <div className={styles.tenantDomainAddForm}>
                                                    <input
                                                        className={styles.tenantDomainAddInput}
                                                        type="text"
                                                        placeholder="*@domain.com or user@email.com"
                                                        value={newDomainInput}
                                                        onChange={(e) => setNewDomainInput(e.target.value)}
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter" && newDomainHint?.type !== "error") {
                                                                handleAddDomain(t.tenant_id);
                                                            }
                                                            if (e.key === "Escape") {
                                                                setAddingDomainFor(null);
                                                                setNewDomainInput("");
                                                            }
                                                        }}
                                                    />
                                                    {newDomainHint && (
                                                        <span className={`${styles.tenantHint} ${newDomainHint.type === "error" ? styles.tenantHintError : ""}`} style={{ fontSize: "0.7rem" }}>
                                                            {newDomainHint.type === "domain" ? "🌐" : newDomainHint.type === "email" ? "✉️" : "⚠️"} {newDomainHint.label}
                                                        </span>
                                                    )}
                                                    <div className={styles.tenantDomainAddActions}>
                                                        <button
                                                            className={styles.tenantDomainAddBtn}
                                                            onClick={() => handleAddDomain(t.tenant_id)}
                                                            disabled={addingDomain || !newDomainInput.trim() || newDomainHint?.type === "error"}
                                                        >
                                                            {addingDomain ? "追加中..." : "追加"}
                                                        </button>
                                                        <button
                                                            className={styles.tenantDomainCancelBtn}
                                                            onClick={() => {
                                                                setAddingDomainFor(null);
                                                                setNewDomainInput("");
                                                            }}
                                                        >
                                                            キャンセル
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    className={styles.tenantDomainAddTrigger}
                                                    onClick={() => {
                                                        setAddingDomainFor(t.tenant_id);
                                                        setNewDomainInput("");
                                                    }}
                                                >
                                                    ＋ アドレス/ドメインを追加
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* モニター版URL案内 */}
                <section className={styles.section}>
                    <h2>📋 モニター版URL</h2>
                    <div className={styles.tenantUrlBox}>
                        <code>https://quick-minutes-trial.vercel.app</code>
                        <button
                            className={styles.tenantCopyBtn}
                            onClick={() => {
                                navigator.clipboard.writeText("https://quick-minutes-trial.vercel.app");
                                setMessage({ type: "success", text: "URLをコピーしました" });
                                setTimeout(() => setMessage(null), 2000);
                            }}
                        >
                            📋 コピー
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
