/**
 * メンバー管理 - IndexedDB ストレージ + Firestore 同期
 * 「私は〇〇です」の音声サンプルを保存
 */

import {
    saveMemberToCloud,
    deleteMemberFromCloud,
    savePresetToCloud,
    deletePresetFromCloud,
} from "./cloud-storage";

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

// 会議プリセット型定義
export type MeetingDuration = 15 | 30 | 45;

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
// メンバー操作
// ===============================

export async function getAllMembers(): Promise<Member[]> {
    try {
        // 1. まずFirestoreから取得を試みる（クラウド優先）
        const { fetchMembersFromCloud } = await import("./cloud-storage");
        const cloudMembers = await fetchMembersFromCloud();

        if (cloudMembers.length > 0) {
            // クラウドデータをローカルIndexedDBに同期
            const db = await openDB();
            const transaction = db.transaction(MEMBERS_STORE, "readwrite");
            const store = transaction.objectStore(MEMBERS_STORE);

            // クラウドのメンバーをローカルに保存
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
        request.onsuccess = () => {
            // Sync to cloud (non-blocking)
            saveMemberToCloud(member).catch(console.error);
            resolve(member);
        };
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
        request.onsuccess = () => {
            // Sync to cloud (non-blocking)
            saveMemberToCloud(updatedMember).catch(console.error);
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
        request.onsuccess = () => {
            // Sync to cloud (non-blocking)
            deleteMemberFromCloud(id).catch(console.error);
            resolve();
        };
    });
}

// ===============================
// プリセット操作
// ===============================

export async function getAllPresets(): Promise<MeetingPreset[]> {
    try {
        // 1. まずFirestoreから取得を試みる（クラウド優先）
        const { fetchPresetsFromCloud } = await import("./cloud-storage");
        const cloudPresets = await fetchPresetsFromCloud();

        if (cloudPresets.length > 0) {
            // クラウドデータをローカルIndexedDBに同期
            const db = await openDB();
            const transaction = db.transaction(PRESETS_STORE, "readwrite");
            const store = transaction.objectStore(PRESETS_STORE);

            // クラウドのプリセットをローカルに保存
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
        request.onsuccess = () => {
            // Sync to cloud (non-blocking)
            savePresetToCloud(preset).catch(console.error);
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
        request.onsuccess = () => {
            // Sync to cloud (non-blocking)
            savePresetToCloud(updatedPreset).catch(console.error);
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
        request.onsuccess = () => {
            // Sync to cloud (non-blocking)
            deletePresetFromCloud(id).catch(console.error);
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
