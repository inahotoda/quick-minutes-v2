/**
 * 話者プロファイルの管理
 * Google Driveに保存されたプロファイルマッピングを読み書き
 */
import { findFileByName, getFileContent, uploadMarkdownAsDoc, updateFile } from "./drive";

const PROFILES_FILENAME = "speaker-profiles.json";
const CONFIG_FOLDER_ID = "1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY";

export interface SpeakerProfile {
    profileId: string;
    name: string;
    enrollmentStatus: string;
    createdAt: string;
    updatedAt: string;
}

export interface SpeakerProfiles {
    profiles: SpeakerProfile[];
    updatedAt: string;
}

// プロファイル一覧を取得
export async function getSpeakerProfiles(): Promise<SpeakerProfiles> {
    try {
        const file = await findFileByName(PROFILES_FILENAME, CONFIG_FOLDER_ID);
        if (file && file.id) {
            const content = await getFileContent(file.id);
            return typeof content === "string" ? JSON.parse(content) : content;
        }
    } catch (error) {
        console.error("[Speaker Profiles] Error loading:", error);
    }

    return { profiles: [], updatedAt: new Date().toISOString() };
}

// プロファイルを追加
export async function addSpeakerProfile(profile: Omit<SpeakerProfile, "createdAt" | "updatedAt">): Promise<SpeakerProfiles> {
    const current = await getSpeakerProfiles();

    const newProfile: SpeakerProfile = {
        ...profile,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    // 既存のプロファイルを更新 or 追加
    const existingIndex = current.profiles.findIndex(p => p.profileId === profile.profileId);
    if (existingIndex >= 0) {
        current.profiles[existingIndex] = {
            ...current.profiles[existingIndex],
            ...profile,
            updatedAt: new Date().toISOString(),
        };
    } else {
        current.profiles.push(newProfile);
    }

    current.updatedAt = new Date().toISOString();

    await saveSpeakerProfiles(current);
    return current;
}

// プロファイルを削除
export async function removeSpeakerProfile(profileId: string): Promise<SpeakerProfiles> {
    const current = await getSpeakerProfiles();
    current.profiles = current.profiles.filter(p => p.profileId !== profileId);
    current.updatedAt = new Date().toISOString();

    await saveSpeakerProfiles(current);
    return current;
}

// プロファイルを保存
async function saveSpeakerProfiles(profiles: SpeakerProfiles): Promise<void> {
    const content = JSON.stringify(profiles, null, 2);

    // 既存ファイルを検索
    const existingFile = await findFileByName(PROFILES_FILENAME, CONFIG_FOLDER_ID);

    if (existingFile && existingFile.id) {
        // 既存ファイルを更新
        await updateFile(existingFile.id, content, "application/json");
    } else {
        // 新規作成（uploadMarkdownAsDocを流用、JSONとして保存）
        // Note: 本来は専用の関数が必要だが、テキストとして保存可能
        await uploadMarkdownAsDoc(PROFILES_FILENAME, content, CONFIG_FOLDER_ID);
    }
}

// プロファイルIDから名前を取得
export async function getNameByProfileId(profileId: string): Promise<string | null> {
    const profiles = await getSpeakerProfiles();
    const profile = profiles.profiles.find(p => p.profileId === profileId);
    return profile?.name || null;
}

// 全プロファイルIDを取得
export async function getAllProfileIds(): Promise<string[]> {
    const profiles = await getSpeakerProfiles();
    return profiles.profiles.map(p => p.profileId);
}
