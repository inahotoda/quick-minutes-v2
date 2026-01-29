/**
 * Azure Speaker Recognition API - 話者登録・識別
 */
import { NextRequest, NextResponse } from "next/server";

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY || "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || "japaneast";
const AZURE_SPEAKER_API_BASE = `https://${AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speaker`;

// プロファイルタイプ
type ProfileType = "textIndependentIdentification";

// 話者プロファイルを作成
async function createProfile(locale: string = "ja-JP"): Promise<{ profileId: string }> {
    const response = await fetch(
        `${AZURE_SPEAKER_API_BASE}/identification/v2.0/text-independent/profiles`,
        {
            method: "POST",
            headers: {
                "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ locale }),
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create profile: ${error}`);
    }

    return response.json();
}

// 音声を登録（エンロール）
async function enrollAudio(profileId: string, audioBlob: Blob): Promise<any> {
    const response = await fetch(
        `${AZURE_SPEAKER_API_BASE}/identification/v2.0/text-independent/profiles/${profileId}/enrollments`,
        {
            method: "POST",
            headers: {
                "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
                "Content-Type": "audio/wav",
            },
            body: audioBlob,
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to enroll audio: ${error}`);
    }

    return response.json();
}

// プロファイルを削除
async function deleteProfile(profileId: string): Promise<void> {
    const response = await fetch(
        `${AZURE_SPEAKER_API_BASE}/identification/v2.0/text-independent/profiles/${profileId}`,
        {
            method: "DELETE",
            headers: {
                "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            },
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to delete profile: ${error}`);
    }
}

// プロファイル情報を取得
async function getProfile(profileId: string): Promise<any> {
    const response = await fetch(
        `${AZURE_SPEAKER_API_BASE}/identification/v2.0/text-independent/profiles/${profileId}`,
        {
            method: "GET",
            headers: {
                "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
            },
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to get profile: ${error}`);
    }

    return response.json();
}

// 話者を識別
async function identifySpeaker(profileIds: string[], audioBlob: Blob): Promise<any> {
    const profileIdsParam = profileIds.join(",");
    const response = await fetch(
        `${AZURE_SPEAKER_API_BASE}/identification/v2.0/text-independent/profiles/identifySingleSpeaker?profileIds=${profileIdsParam}`,
        {
            method: "POST",
            headers: {
                "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
                "Content-Type": "audio/wav",
            },
            body: audioBlob,
        }
    );

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to identify speaker: ${error}`);
    }

    return response.json();
}

// POST: 新規プロファイル作成 & 音声登録
export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const action = formData.get("action") as string;
        const name = formData.get("name") as string;
        const audioFile = formData.get("audio") as Blob | null;

        if (action === "enroll") {
            // 新規登録
            if (!name || !audioFile) {
                return NextResponse.json({ error: "名前と音声データが必要です" }, { status: 400 });
            }

            // 1. プロファイル作成
            const { profileId } = await createProfile("ja-JP");
            console.log(`[Speaker] Created profile: ${profileId} for ${name}`);

            // 2. 音声登録
            const enrollResult = await enrollAudio(profileId, audioFile);
            console.log(`[Speaker] Enrolled audio for ${name}:`, enrollResult);

            return NextResponse.json({
                success: true,
                profileId,
                name,
                enrollmentStatus: enrollResult.enrollmentStatus,
                remainingEnrollmentsSpeechLength: enrollResult.remainingEnrollmentsSpeechLength,
            });
        }

        if (action === "identify") {
            // 話者識別
            const profileIds = formData.get("profileIds") as string;
            if (!profileIds || !audioFile) {
                return NextResponse.json({ error: "プロファイルIDと音声データが必要です" }, { status: 400 });
            }

            const result = await identifySpeaker(profileIds.split(","), audioFile);
            return NextResponse.json(result);
        }

        return NextResponse.json({ error: "無効なアクション" }, { status: 400 });
    } catch (error: any) {
        console.error("[Speaker API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// GET: プロファイル情報取得
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const profileId = searchParams.get("profileId");

        if (!profileId) {
            return NextResponse.json({ error: "profileIdが必要です" }, { status: 400 });
        }

        const profile = await getProfile(profileId);
        return NextResponse.json(profile);
    } catch (error: any) {
        console.error("[Speaker API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE: プロファイル削除
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const profileId = searchParams.get("profileId");

        if (!profileId) {
            return NextResponse.json({ error: "profileIdが必要です" }, { status: 400 });
        }

        await deleteProfile(profileId);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("[Speaker API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
