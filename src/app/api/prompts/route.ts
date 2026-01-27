import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { findFileByName, getFileContent, updateFile, uploadFile } from "@/lib/drive";

const PROMPTS_FILENAME = "prompts-config.json";
const LOCAL_PROMPTS_FILE = path.join(process.cwd(), "prompts-config.json");
const CONFIG_FOLDER_ID = "1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY";

interface PromptConfig {
    basePrompt: string;
    internalPrompt: string;
    businessPrompt: string;
    otherPrompt: string;
    terminology: string;
    updatedBy?: string;
    updatedAt?: string;
    history?: Array<Omit<PromptConfig, "history">>;
}

const DEFAULT_CONFIG: PromptConfig = {
    basePrompt: "",
    internalPrompt: "",
    businessPrompt: "",
    otherPrompt: "",
    terminology: "",
    history: []
};

async function getMergedConfig(): Promise<PromptConfig> {
    try {
        // 1. Google Driveから検索
        const file = await findFileByName(PROMPTS_FILENAME, CONFIG_FOLDER_ID);
        if (file && file.id) {
            const content = await getFileContent(file.id) as any;
            return typeof content === "string" ? JSON.parse(content) : content;
        }

        // 2. なければローカル（初期値）から読み込み
        const data = await fs.readFile(LOCAL_PROMPTS_FILE, "utf-8");
        return JSON.parse(data);
    } catch (error) {
        return DEFAULT_CONFIG;
    }
}

export async function GET() {
    try {
        const config = await getMergedConfig();
        return NextResponse.json(config);
    } catch (error) {
        return NextResponse.json(DEFAULT_CONFIG);
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const newConfig = await request.json();

        // 1. 現在の設定を読み込む
        const currentConfig = await getMergedConfig();

        // 2. 履歴を更新
        const history = currentConfig.history || [];
        const { history: _, ...oldStateWithoutHistory } = currentConfig;

        if (oldStateWithoutHistory.basePrompt || oldStateWithoutHistory.internalPrompt) {
            history.unshift(oldStateWithoutHistory);
        }
        const updatedHistory = history.slice(0, 10);

        // 3. 新しい設定を作成
        const finalConfig: PromptConfig = {
            ...newConfig,
            updatedBy: session.user?.name || "不明なユーザー",
            updatedAt: new Date().toISOString(),
            history: updatedHistory
        };

        const configContent = JSON.stringify(finalConfig, null, 2);

        // 4. Google Driveに保存
        const file = await findFileByName(PROMPTS_FILENAME, CONFIG_FOLDER_ID);
        if (file && file.id) {
            // 更新
            await updateFile(file.id, configContent, "application/json");
        } else {
            // 新規作成 (uploadFileはbase64を期待するのでBuffer経由)
            const base64 = Buffer.from(configContent).toString("base64");
            await uploadFile(PROMPTS_FILENAME, base64, "application/json", CONFIG_FOLDER_ID);
        }

        return NextResponse.json({ success: true, config: finalConfig });
    } catch (error) {
        console.error("Save prompts error:", error);
        return NextResponse.json(
            { error: "設定の保存に失敗しました" },
            { status: 500 }
        );
    }
}
