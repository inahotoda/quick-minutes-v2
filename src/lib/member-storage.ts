/**
 * メンバー・プリセット管理
 * Supabase（knowledge DB）をSingle Source of Truthとし、API経由で直接CRUD
 */

// ===============================
// 型定義・定数（変更なし）
// ===============================

export interface Member {
    id: string;
    name: string;
    nameVariants?: string[];
    email?: string | null;
    company?: string | null;
    department?: string | null;
    role?: string | null;
    type?: MemberType;
    voiceSample?: {
        blob: Blob;
        duration: number;
        recordedAt: string;
    };
    createdAt: string;
    updatedAt: string;
}

export type MemberType = "internal" | "client" | "supplier" | "other";

export const MEMBER_TYPE_LABELS: Record<MemberType, string> = {
    internal: "社内",
    client: "顧客",
    supplier: "仕入先",
    other: "その他",
};

export const MEMBER_TYPE_COLORS: Record<MemberType, { bg: string; border: string; text: string }> = {
    internal: { bg: "rgba(99,102,241,0.15)", border: "rgba(99,102,241,0.4)", text: "#a5b4fc" },
    client: { bg: "rgba(16,185,129,0.15)", border: "rgba(16,185,129,0.4)", text: "#6ee7b7" },
    supplier: { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)", text: "#fcd34d" },
    other: { bg: "rgba(156,163,175,0.2)", border: "rgba(156,163,175,0.5)", text: "#e5e7eb" },
};

export type MeetingDuration = 30 | 60 | 0; // 0 = 無制限

export interface MeetingPreset {
    id: string;
    name: string;
    mode: "internal" | "business" | "other";
    duration?: MeetingDuration;
    memberIds: string[];
    additionalPrompt?: string;
    isArchived?: boolean;
    lastUsedAt?: string;
    usageCount?: number;
    createdAt: string;
    updatedAt: string;
}

// ===============================
// Blob ↔ Base64 ユーティリティ
// ===============================

async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            const base64Data = base64.split(",")[1];
            resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

// ===============================
// API レスポンス → Member 変換
// ===============================

interface MemberData {
    id: string;
    name: string;
    nameVariants?: string[];
    email?: string | null;
    company?: string | null;
    department?: string | null;
    role?: string | null;
    type?: MemberType;
    voiceSample?: {
        blobBase64: string;
        duration: number;
        recordedAt: string;
    };
    createdAt: string;
    updatedAt: string;
}

function dataToMember(data: MemberData): Member {
    let migratedType = data.type;
    if (migratedType === ("external" as any)) {
        migratedType = "client";
    }
    const member: Member = {
        id: data.id,
        name: data.name,
        nameVariants: data.nameVariants,
        email: data.email,
        company: data.company,
        department: data.department,
        role: data.role,
        type: migratedType,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
    };
    if (data.voiceSample) {
        member.voiceSample = {
            blob: base64ToBlob(data.voiceSample.blobBase64, "audio/webm"),
            duration: data.voiceSample.duration,
            recordedAt: data.voiceSample.recordedAt,
        };
    }
    return member;
}

// ===============================
// メンバー操作（API直接呼び出し）
// ===============================

export async function getAllMembers(): Promise<Member[]> {
    try {
        const response = await fetch("/api/members");
        if (!response.ok) return [];
        const { members } = await response.json();
        return (members || []).map(dataToMember);
    } catch (error) {
        console.warn("Failed to fetch members:", error);
        return [];
    }
}

export async function getMember(id: string): Promise<Member | undefined> {
    try {
        const response = await fetch(`/api/members/${encodeURIComponent(id)}`);
        if (!response.ok) return undefined;
        const { member } = await response.json();
        return member ? dataToMember(member) : undefined;
    } catch (error) {
        console.warn("Failed to fetch member:", error);
        return undefined;
    }
}

export async function addMember(
    name: string,
    voiceBlob?: Blob,
    voiceDuration?: number,
): Promise<Member> {
    const body: any = { name: name.trim() };

    if (voiceBlob && voiceDuration) {
        body.voiceSample = {
            blobBase64: await blobToBase64(voiceBlob),
            duration: voiceDuration,
            recordedAt: new Date().toISOString(),
        };
    }

    const response = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "メンバーの追加に失敗しました");
    }

    const { member } = await response.json();
    return dataToMember(member);
}

export async function updateMember(
    id: string,
    updates: Partial<Pick<Member, "name" | "nameVariants" | "email" | "company" | "department" | "role" | "type" | "voiceSample">>,
): Promise<void> {
    const body: any = {};

    if (updates.name !== undefined) body.name = updates.name;
    if (updates.nameVariants !== undefined) body.nameVariants = updates.nameVariants;
    if (updates.email !== undefined) body.email = updates.email;
    if (updates.company !== undefined) body.company = updates.company;
    if (updates.department !== undefined) body.department = updates.department;
    if (updates.role !== undefined) body.role = updates.role;
    if (updates.type !== undefined) body.type = updates.type;

    if (updates.voiceSample?.blob) {
        body.voiceSample = {
            blobBase64: await blobToBase64(updates.voiceSample.blob),
            duration: updates.voiceSample.duration,
            recordedAt: updates.voiceSample.recordedAt,
        };
    }

    const response = await fetch(`/api/members/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "メンバーの更新に失敗しました");
    }
}

export async function deleteMember(id: string): Promise<void> {
    const response = await fetch(`/api/members/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "メンバーの削除に失敗しました");
    }
}

// ===============================
// プリセット操作（API直接呼び出し）
// ===============================

export async function getAllPresets(): Promise<MeetingPreset[]> {
    try {
        const response = await fetch("/api/presets");
        if (!response.ok) return [];
        const { presets } = await response.json();
        return presets || [];
    } catch (error) {
        console.warn("Failed to fetch presets:", error);
        return [];
    }
}

export async function getPreset(id: string): Promise<MeetingPreset | undefined> {
    try {
        const response = await fetch(`/api/presets/${encodeURIComponent(id)}`);
        if (!response.ok) return undefined;
        const { preset } = await response.json();
        return preset || undefined;
    } catch (error) {
        console.warn("Failed to fetch preset:", error);
        return undefined;
    }
}

export async function addPreset(
    name: string,
    mode: MeetingPreset["mode"],
    memberIds: string[],
    duration?: MeetingDuration,
): Promise<MeetingPreset> {
    const response = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode, memberIds, duration }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "プリセットの追加に失敗しました");
    }

    const { preset } = await response.json();
    return preset;
}

export async function updatePreset(
    id: string,
    updates: Partial<Pick<MeetingPreset, "name" | "mode" | "duration" | "memberIds" | "additionalPrompt" | "isArchived" | "lastUsedAt" | "usageCount">>,
): Promise<void> {
    const response = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "プリセットの更新に失敗しました");
    }
}

export async function deletePreset(id: string): Promise<void> {
    const response = await fetch(`/api/presets/${encodeURIComponent(id)}`, {
        method: "DELETE",
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "プリセットの削除に失敗しました");
    }
}

// ===============================
// ユーティリティ
// ===============================

export async function combineVoiceSamples(memberIds: string[]): Promise<Blob | null> {
    const members = await Promise.all(memberIds.map(id => getMember(id)));
    const blobs: Blob[] = [];

    for (const member of members) {
        if (member?.voiceSample?.blob) {
            blobs.push(member.voiceSample.blob);
        }
    }

    if (blobs.length === 0) return null;
    return new Blob(blobs, { type: "audio/webm" });
}
