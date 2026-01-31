"use client";

/**
 * Firestore Cloud Storage
 * メンバーとプリセットをクラウドに同期
 */

import {
    collection,
    doc,
    getDocs,
    setDoc,
    deleteDoc,
    writeBatch,
    query,
    orderBy,
} from "firebase/firestore";
import { getFirestoreDb, isFirebaseConfigured } from "./firebase";
import type { Member, MeetingPreset } from "./member-storage";

// Collection names
const MEMBERS_COLLECTION = "members";
const PRESETS_COLLECTION = "presets";

// ユーザーIDを取得（セッションから）
async function getUserId(): Promise<string | null> {
    try {
        // Next.jsのセッションからユーザーIDを取得
        const response = await fetch("/api/auth/session");
        const session = await response.json();
        return session?.user?.email || null;
    } catch {
        return null;
    }
}

// ===============================
// メンバー同期
// ===============================

// Firestoreから全メンバーを取得
export async function fetchMembersFromCloud(): Promise<Member[]> {
    if (!isFirebaseConfigured()) return [];

    const userId = await getUserId();
    if (!userId) return [];

    try {
        const db = getFirestoreDb();
        const membersRef = collection(db, "users", userId, MEMBERS_COLLECTION);
        const q = query(membersRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                voiceSample: data.voiceSample
                    ? {
                        // Note: Blob is stored as base64 in Firestore
                        blob: base64ToBlob(data.voiceSample.blobBase64, "audio/webm"),
                        duration: data.voiceSample.duration,
                        recordedAt: data.voiceSample.recordedAt,
                    }
                    : undefined,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
            } as Member;
        });
    } catch (error) {
        console.error("Failed to fetch members from cloud:", error);
        return [];
    }
}

// メンバーをFirestoreに保存
export async function saveMemberToCloud(member: Member): Promise<void> {
    if (!isFirebaseConfigured()) return;

    const userId = await getUserId();
    if (!userId) return;

    try {
        const db = getFirestoreDb();
        const memberRef = doc(db, "users", userId, MEMBERS_COLLECTION, member.id);

        // Convert Blob to base64 for storage
        let voiceSampleData = null;
        if (member.voiceSample) {
            const blobBase64 = await blobToBase64(member.voiceSample.blob);
            voiceSampleData = {
                blobBase64,
                duration: member.voiceSample.duration,
                recordedAt: member.voiceSample.recordedAt,
            };
        }

        await setDoc(memberRef, {
            name: member.name,
            voiceSample: voiceSampleData,
            createdAt: member.createdAt,
            updatedAt: member.updatedAt,
        });
    } catch (error) {
        console.error("Failed to save member to cloud:", error);
    }
}

// メンバーをFirestoreから削除
export async function deleteMemberFromCloud(memberId: string): Promise<void> {
    if (!isFirebaseConfigured()) return;

    const userId = await getUserId();
    if (!userId) return;

    try {
        const db = getFirestoreDb();
        const memberRef = doc(db, "users", userId, MEMBERS_COLLECTION, memberId);
        await deleteDoc(memberRef);
    } catch (error) {
        console.error("Failed to delete member from cloud:", error);
    }
}

// ===============================
// プリセット同期
// ===============================

// Firestoreから全プリセットを取得
export async function fetchPresetsFromCloud(): Promise<MeetingPreset[]> {
    if (!isFirebaseConfigured()) return [];

    const userId = await getUserId();
    if (!userId) return [];

    try {
        const db = getFirestoreDb();
        const presetsRef = collection(db, "users", userId, PRESETS_COLLECTION);
        const q = query(presetsRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as MeetingPreset[];
    } catch (error) {
        console.error("Failed to fetch presets from cloud:", error);
        return [];
    }
}

// プリセットをFirestoreに保存
export async function savePresetToCloud(preset: MeetingPreset): Promise<void> {
    if (!isFirebaseConfigured()) return;

    const userId = await getUserId();
    if (!userId) return;

    try {
        const db = getFirestoreDb();
        const presetRef = doc(db, "users", userId, PRESETS_COLLECTION, preset.id);
        await setDoc(presetRef, {
            name: preset.name,
            mode: preset.mode,
            memberIds: preset.memberIds,
            createdAt: preset.createdAt,
            updatedAt: preset.updatedAt,
        });
    } catch (error) {
        console.error("Failed to save preset to cloud:", error);
    }
}

// プリセットをFirestoreから削除
export async function deletePresetFromCloud(presetId: string): Promise<void> {
    if (!isFirebaseConfigured()) return;

    const userId = await getUserId();
    if (!userId) return;

    try {
        const db = getFirestoreDb();
        const presetRef = doc(db, "users", userId, PRESETS_COLLECTION, presetId);
        await deleteDoc(presetRef);
    } catch (error) {
        console.error("Failed to delete preset from cloud:", error);
    }
}

// ===============================
// 一括同期
// ===============================

// ローカルデータをクラウドに一括アップロード
export async function syncLocalToCloud(
    members: Member[],
    presets: MeetingPreset[]
): Promise<void> {
    if (!isFirebaseConfigured()) return;

    const userId = await getUserId();
    if (!userId) return;

    try {
        const db = getFirestoreDb();
        const batch = writeBatch(db);

        // Sync members
        for (const member of members) {
            const memberRef = doc(db, "users", userId, MEMBERS_COLLECTION, member.id);
            let voiceSampleData = null;
            if (member.voiceSample) {
                const blobBase64 = await blobToBase64(member.voiceSample.blob);
                voiceSampleData = {
                    blobBase64,
                    duration: member.voiceSample.duration,
                    recordedAt: member.voiceSample.recordedAt,
                };
            }
            batch.set(memberRef, {
                name: member.name,
                voiceSample: voiceSampleData,
                createdAt: member.createdAt,
                updatedAt: member.updatedAt,
            });
        }

        // Sync presets
        for (const preset of presets) {
            const presetRef = doc(db, "users", userId, PRESETS_COLLECTION, preset.id);
            batch.set(presetRef, {
                name: preset.name,
                mode: preset.mode,
                memberIds: preset.memberIds,
                createdAt: preset.createdAt,
                updatedAt: preset.updatedAt,
            });
        }

        await batch.commit();
        console.log("Synced to cloud:", { members: members.length, presets: presets.length });
    } catch (error) {
        console.error("Failed to sync to cloud:", error);
    }
}

// ===============================
// ユーティリティ
// ===============================

// Blob to Base64
async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64 = reader.result as string;
            // Remove data URL prefix
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
