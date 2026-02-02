/**
 * メンバー管理 - IndexedDB ストレージ + Google Drive 同期
 * 「私は〇〇です」の音声サンプルを保存
 */

// メンバー型定義
export interface Member {
    id: string;
    name: string;
    voiceSample?: {
        blob: Blob;
        duration: number;
        recordedAt: string;
    };
    createdAt: string;
    updatedAt: string;
}

// API用のメンバー型（BlobはBase64として保存）
interface MemberData {
    id: string;
    name: string;
    voiceSample?: {
        blobBase64: string;
        duration: number;
        recordedAt: string;
    };
    createdAt: string;
    updatedAt: string;
}

// 会議プリセット型定義
export type MeetingDuration = 30 | 60 | 0; // 0 = 無制限

export interface MeetingPreset {
    id: string;
    name: string;
    mode: "internal" | "business" | "other";
    duration?: MeetingDuration;
    memberIds: string[];
    createdAt: string;
    updatedAt: string;
}

const DB_NAME = "quick-minutes-db";
const DB_VERSION = 1;
const MEMBERS_STORE = "members";
const PRESETS_STORE = "presets";

// データベースを開く
function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // メンバーストア
            if (!db.objectStoreNames.contains(MEMBERS_STORE)) {
                const memberStore = db.createObjectStore(MEMBERS_STORE, { keyPath: "id" });
                memberStore.createIndex("name", "name", { unique: false });
            }

            // プリセットストア
            if (!db.objectStoreNames.contains(PRESETS_STORE)) {
                const presetStore = db.createObjectStore(PRESETS_STORE, { keyPath: "id" });
                presetStore.createIndex("name", "name", { unique: false });
            }
        };
    });
}

// ===============================
// ユーティリティ関数
// ===============================

// Blob to Base64
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

// Base64 to Blob
function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

// Member to MemberData (for API)
async function memberToData(member: Member): Promise<MemberData> {
    const data: MemberData = {
        id: member.id,
        name: member.name,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
    };
    if (member.voiceSample) {
        data.voiceSample = {
            blobBase64: await blobToBase64(member.voiceSample.blob),
            duration: member.voiceSample.duration,
            recordedAt: member.voiceSample.recordedAt,
        };
    }
    return data;
}

// MemberData to Member (from API)
function dataToMember(data: MemberData): Member {
    const member: Member = {
        id: data.id,
        name: data.name,
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
// Google Drive API呼び出し
// ===============================

async function fetchMembersFromAPI(): Promise<Member[]> {
    try {
        const response = await fetch("/api/members");
        if (!response.ok) return [];
        const { members } = await response.json();
        return (members || []).map(dataToMember);
    } catch (error) {
        console.warn("Failed to fetch members from API:", error);
        return [];
    }
}

async function saveMembersToAPI(members: Member[]): Promise<void> {
    try {
        const membersData = await Promise.all(members.map(memberToData));
        await fetch("/api/members", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ members: membersData }),
        });
    } catch (error) {
        console.error("Failed to save members to API:", error);
    }
}

async function fetchPresetsFromAPI(): Promise<MeetingPreset[]> {
    try {
        const response = await fetch("/api/presets");
        if (!response.ok) return [];
        const { presets } = await response.json();
        return presets || [];
    } catch (error) {
        console.warn("Failed to fetch presets from API:", error);
        return [];
    }
}

async function savePresetsToAPI(presets: MeetingPreset[]): Promise<void> {
    try {
        await fetch("/api/presets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ presets }),
        });
    } catch (error) {
        console.error("Failed to save presets to API:", error);
    }
}

// ===============================
// メンバー操作
// ===============================

export async function getAllMembers(): Promise<Member[]> {
    try {
        // 1. まずGoogle Drive APIから取得を試みる（クラウド優先）
        const cloudMembers = await fetchMembersFromAPI();

        if (cloudMembers.length > 0) {
            // クラウドデータをローカルIndexedDBに同期
            const db = await openDB();
            const transaction = db.transaction(MEMBERS_STORE, "readwrite");
            const store = transaction.objectStore(MEMBERS_STORE);

            for (const member of cloudMembers) {
                store.put(member);
            }

            return cloudMembers;
        }
    } catch (error) {
        console.warn("Cloud fetch failed, falling back to local:", error);
    }

    // 2. クラウドから取得できなければローカルから取得
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MEMBERS_STORE, "readonly");
        const store = transaction.objectStore(MEMBERS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
    });
}

export async function getMember(id: string): Promise<Member | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MEMBERS_STORE, "readonly");
        const store = transaction.objectStore(MEMBERS_STORE);
        const request = store.get(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

export async function addMember(name: string, voiceBlob?: Blob, voiceDuration?: number): Promise<Member> {
    const db = await openDB();
    const now = new Date().toISOString();
    const member: Member = {
        id: `member-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        createdAt: now,
        updatedAt: now,
    };

    if (voiceBlob && voiceDuration) {
        member.voiceSample = {
            blob: voiceBlob,
            duration: voiceDuration,
            recordedAt: now,
        };
    }

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MEMBERS_STORE, "readwrite");
        const store = transaction.objectStore(MEMBERS_STORE);
        const request = store.add(member);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            // Sync to Google Drive (non-blocking)
            const allMembers = await getAllMembersLocal();
            saveMembersToAPI(allMembers).catch(console.error);
            resolve(member);
        };
    });
}

// ローカルのみから取得（同期用）
async function getAllMembersLocal(): Promise<Member[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MEMBERS_STORE, "readonly");
        const store = transaction.objectStore(MEMBERS_STORE);
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
    });
}

export async function updateMember(id: string, updates: Partial<Pick<Member, "name" | "voiceSample">>): Promise<void> {
    const db = await openDB();
    const member = await getMember(id);
    if (!member) throw new Error("Member not found");

    const updatedMember = {
        ...member,
        ...updates,
        updatedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MEMBERS_STORE, "readwrite");
        const store = transaction.objectStore(MEMBERS_STORE);
        const request = store.put(updatedMember);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            // Sync to Google Drive (non-blocking)
            const allMembers = await getAllMembersLocal();
            saveMembersToAPI(allMembers).catch(console.error);
            resolve();
        };
    });
}

export async function deleteMember(id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(MEMBERS_STORE, "readwrite");
        const store = transaction.objectStore(MEMBERS_STORE);
        const request = store.delete(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            // Sync to Google Drive (non-blocking)
            const allMembers = await getAllMembersLocal();
            saveMembersToAPI(allMembers).catch(console.error);
            resolve();
        };
    });
}

// ===============================
// プリセット操作
// ===============================

export async function getAllPresets(): Promise<MeetingPreset[]> {
    try {
        // 1. まずGoogle Drive APIから取得を試みる（クラウド優先）
        const cloudPresets = await fetchPresetsFromAPI();

        if (cloudPresets.length > 0) {
            // クラウドデータをローカルIndexedDBに同期
            const db = await openDB();
            const transaction = db.transaction(PRESETS_STORE, "readwrite");
            const store = transaction.objectStore(PRESETS_STORE);

            for (const preset of cloudPresets) {
                store.put(preset);
            }

            return cloudPresets;
        }
    } catch (error) {
        console.warn("Cloud fetch failed, falling back to local:", error);
    }

    // 2. クラウドから取得できなければローカルから取得
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PRESETS_STORE, "readonly");
        const store = transaction.objectStore(PRESETS_STORE);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
    });
}

export async function getPreset(id: string): Promise<MeetingPreset | undefined> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PRESETS_STORE, "readonly");
        const store = transaction.objectStore(PRESETS_STORE);
        const request = store.get(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

// ローカルのみから取得（同期用）
async function getAllPresetsLocal(): Promise<MeetingPreset[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PRESETS_STORE, "readonly");
        const store = transaction.objectStore(PRESETS_STORE);
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result || []);
    });
}

export async function addPreset(
    name: string,
    mode: MeetingPreset["mode"],
    memberIds: string[],
    duration?: MeetingDuration
): Promise<MeetingPreset> {
    const db = await openDB();
    const now = new Date().toISOString();
    const preset: MeetingPreset = {
        id: `preset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        mode,
        duration,
        memberIds,
        createdAt: now,
        updatedAt: now,
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PRESETS_STORE, "readwrite");
        const store = transaction.objectStore(PRESETS_STORE);
        const request = store.add(preset);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            // Sync to Google Drive (non-blocking)
            const allPresets = await getAllPresetsLocal();
            savePresetsToAPI(allPresets).catch(console.error);
            resolve(preset);
        };
    });
}

export async function updatePreset(
    id: string,
    updates: Partial<Pick<MeetingPreset, "name" | "mode" | "duration" | "memberIds">>
): Promise<void> {
    const db = await openDB();
    const preset = await getPreset(id);
    if (!preset) throw new Error("Preset not found");

    const updatedPreset = {
        ...preset,
        ...updates,
        updatedAt: new Date().toISOString(),
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PRESETS_STORE, "readwrite");
        const store = transaction.objectStore(PRESETS_STORE);
        const request = store.put(updatedPreset);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            // Sync to Google Drive (non-blocking)
            const allPresets = await getAllPresetsLocal();
            savePresetsToAPI(allPresets).catch(console.error);
            resolve();
        };
    });
}

export async function deletePreset(id: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PRESETS_STORE, "readwrite");
        const store = transaction.objectStore(PRESETS_STORE);
        const request = store.delete(id);

        request.onerror = () => reject(request.error);
        request.onsuccess = async () => {
            // Sync to Google Drive (non-blocking)
            const allPresets = await getAllPresetsLocal();
            savePresetsToAPI(allPresets).catch(console.error);
            resolve();
        };
    });
}

// ===============================
// ユーティリティ
// ===============================

// メンバーの音声サンプルを結合して1つのBlobにする
export async function combineVoiceSamples(memberIds: string[]): Promise<Blob | null> {
    const members = await Promise.all(memberIds.map(id => getMember(id)));
    const blobs: Blob[] = [];

    for (const member of members) {
        if (member?.voiceSample?.blob) {
            blobs.push(member.voiceSample.blob);
        }
    }

    if (blobs.length === 0) return null;

    // 音声Blobを結合（簡易版 - 実際には適切な音声結合が必要）
    return new Blob(blobs, { type: "audio/webm" });
}
