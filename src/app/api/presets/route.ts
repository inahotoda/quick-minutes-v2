import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findFileByName, getFileContent, updateFile, uploadFile } from "@/lib/drive";

const PRESETS_FILENAME = "presets-config.json";
const CONFIG_FOLDER_ID = "1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY";

interface PresetData {
    id: string;
    name: string;
    mode: "internal" | "business" | "other";
    duration?: 30 | 60 | 0; // 0 = 無制限
    memberIds: string[];
    createdAt: string;
    updatedAt: string;
}

interface PresetsConfig {
    presets: PresetData[];
    updatedAt: string;
}

// GET: プリセット一覧を取得
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ presets: [] });
        }

        console.log("GET /api/presets: searching for", PRESETS_FILENAME);
        const file = await findFileByName(PRESETS_FILENAME, CONFIG_FOLDER_ID);

        if (file && file.id) {
            console.log("GET /api/presets: found file, ID:", file.id);
            const content = await getFileContent(file.id);
            if (content && content.trim()) {
                try {
                    const config: PresetsConfig = JSON.parse(content);
                    return NextResponse.json({ presets: config.presets || [] });
                } catch (pe) {
                    console.error("GET /api/presets: JSON parse error", pe);
                }
            }
        }

        console.log("GET /api/presets: no file found, returning empty");
        return NextResponse.json({ presets: [] });
    } catch (error) {
        console.error("GET /api/presets error:", error);
        return NextResponse.json({ presets: [] });
    }
}

// POST: プリセット一覧を保存
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const { presets } = await request.json();
        console.log("POST /api/presets: saving", presets.length, "presets");

        const config: PresetsConfig = {
            presets: presets || [],
            updatedAt: new Date().toISOString(),
        };

        const configContent = JSON.stringify(config, null, 2);

        // Google Driveに保存
        const file = await findFileByName(PRESETS_FILENAME, CONFIG_FOLDER_ID);
        if (file && file.id) {
            console.log("POST /api/presets: updating existing file", file.id);
            await updateFile(file.id, configContent, "application/json");
        } else {
            console.log("POST /api/presets: creating new file in folder", CONFIG_FOLDER_ID);
            const base64 = Buffer.from(configContent).toString("base64");
            await uploadFile(PRESETS_FILENAME, base64, "application/json", CONFIG_FOLDER_ID);
        }

        console.log("POST /api/presets: save successful");
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("POST /api/presets error:", error);
        return NextResponse.json(
            { error: error.message || "保存に失敗しました" },
            { status: 500 }
        );
    }
}
