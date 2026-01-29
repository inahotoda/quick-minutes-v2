/**
 * 話者プロファイル一覧API
 */
import { NextResponse } from "next/server";
import { getSpeakerProfiles, addSpeakerProfile, removeSpeakerProfile } from "@/lib/speaker-profiles";

// GET: プロファイル一覧を取得
export async function GET() {
    try {
        const profiles = await getSpeakerProfiles();
        return NextResponse.json(profiles);
    } catch (error: any) {
        console.error("[Speaker Profiles API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST: プロファイルを追加/更新
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { profileId, name, enrollmentStatus } = body;

        if (!profileId || !name) {
            return NextResponse.json({ error: "profileIdとnameが必要です" }, { status: 400 });
        }

        const profiles = await addSpeakerProfile({ profileId, name, enrollmentStatus });
        return NextResponse.json(profiles);
    } catch (error: any) {
        console.error("[Speaker Profiles API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE: プロファイルを削除
export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const profileId = searchParams.get("profileId");

        if (!profileId) {
            return NextResponse.json({ error: "profileIdが必要です" }, { status: 400 });
        }

        const profiles = await removeSpeakerProfile(profileId);
        return NextResponse.json(profiles);
    } catch (error: any) {
        console.error("[Speaker Profiles API] Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
