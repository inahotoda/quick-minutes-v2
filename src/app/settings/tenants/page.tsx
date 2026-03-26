"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "../settings.module.css";

interface Tenant {
    tenant_id: string;
    domain: string;
    email: string | null;
    company_name: string;
    match_type: string;
    is_active: boolean;
    expires_at: string;
    created_at: string;
}

export default function TenantsPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

    // 入力フォーム
    const [input, setInput] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [days, setDays] = useState(30);
    const [saving, setSaving] = useState(false);

    // 削除中のテナントID
    const [deletingId, setDeletingId] = useState<string | null>(null);

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

    const handleDelete = async (tenantId: string, name: string) => {
        if (!confirm(`${name} を削除しますか？`)) return;
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

    // 入力内容からマッチ方式を判定して表示
    const getInputHint = () => {
        const trimmed = input.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("*@")) {
            return { type: "domain", label: `${trimmed.slice(2)} ドメインの全ユーザーを許可` };
        }
        if (trimmed.includes("@")) {
            return { type: "email", label: `${trimmed} のみ許可` };
        }
        return { type: "error", label: "「*@ドメイン」または「メールアドレス」形式で入力" };
    };

    const hint = getInputHint();

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

                                return (
                                    <div
                                        key={t.tenant_id}
                                        className={`${styles.tenantCard} ${expired ? styles.tenantExpired : ""}`}
                                    >
                                        <div className={styles.tenantCardMain}>
                                            <div className={styles.tenantCardInfo}>
                                                <span className={styles.tenantCompany}>{t.company_name}</span>
                                                <span className={styles.tenantDomain}>
                                                    {t.match_type === "email"
                                                        ? `✉️ ${t.email}`
                                                        : `🌐 *@${t.domain}`}
                                                </span>
                                            </div>
                                            <div className={styles.tenantCardRight}>
                                                <span className={`${styles.tenantStatus} ${expired ? styles.tenantStatusExpired : styles.tenantStatusActive}`}>
                                                    {expired ? "期限切れ" : `残り${remaining}日`}
                                                </span>
                                                <button
                                                    className={styles.tenantDeleteBtn}
                                                    onClick={() => handleDelete(t.tenant_id, t.company_name)}
                                                    disabled={deletingId === t.tenant_id}
                                                >
                                                    {deletingId === t.tenant_id ? "..." : "削除"}
                                                </button>
                                            </div>
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
