import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findFileByName, getFileContent, updateFile, uploadFile } from "@/lib/drive";

const MEMBERS_FILENAME = "members-config.json";
const CONFIG_FOLDER_ID = "1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY";

interface VoiceSampleData {
    blobBase64: string;
    duration: number;
    recordedAt: string;
}

interface MemberData {
    id: string;
    name: string;
    voiceSample?: VoiceSampleData;
    createdAt: string;
    updatedAt: string;
}

interface MembersConfig {
    members: MemberData[];
    updatedAt: string;
}

// GET: メンバー一覧を取得
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ members: [] });
        }

        console.log("GET /api/members: searching for", MEMBERS_FILENAME);
        const file = await findFileByName(MEMBERS_FILENAME, CONFIG_FOLDER_ID);

        if (file && file.id) {
            console.log("GET /api/members: found file, ID:", file.id);
            const content = await getFileContent(file.id);
            if (content && content.trim()) {
                try {
                    const config: MembersConfig = JSON.parse(content);
                    return NextResponse.json({ members: config.members || [] });
                } catch (pe) {
                    console.error("GET /api/members: JSON parse error", pe);
                }
            }
        }

        console.log("GET /api/members: no file found, returning empty");
        return NextResponse.json({ members: [] });
    } catch (error) {
        console.error("GET /api/members error:", error);
        return NextResponse.json({ members: [] });
    }
}

// POST: メンバー一覧を保存
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const { members } = await request.json();
        console.log("POST /api/members: saving", members.length, "members");

        const config: MembersConfig = {
            members: members || [],
            updatedAt: new Date().toISOString(),
        };

        const configContent = JSON.stringify(config, null, 2);

        // Google Driveに保存
        const file = await findFileByName(MEMBERS_FILENAME, CONFIG_FOLDER_ID);
        if (file && file.id) {
            console.log("POST /api/members: updating existing file", file.id);
            await updateFile(file.id, configContent, "application/json");
        } else {
            console.log("POST /api/members: creating new file in folder", CONFIG_FOLDER_ID);
            const base64 = Buffer.from(configContent).toString("base64");
            await uploadFile(MEMBERS_FILENAME, base64, "application/json", CONFIG_FOLDER_ID);
        }

        console.log("POST /api/members: save successful");
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("POST /api/members error:", error);
        return NextResponse.json(
            { error: error.message || "保存に失敗しました" },
            { status: 500 }
        );
    }
}
