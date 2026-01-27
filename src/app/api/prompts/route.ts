import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

const PROMPTS_FILE = path.join(process.cwd(), "prompts-config.json");

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

export async function GET() {
    try {
        const data = await fs.readFile(PROMPTS_FILE, "utf-8");
        return NextResponse.json(JSON.parse(data));
    } catch (error) {
        return NextResponse.json({
            basePrompt: "",
            internalPrompt: "",
            businessPrompt: "",
            otherPrompt: "",
            terminology: "",
            history: []
        });
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const newConfig = await request.json();

        // 現在の設定を読み込む（履歴作成のため）
        let currentConfig: PromptConfig;
        try {
            const data = await fs.readFile(PROMPTS_FILE, "utf-8");
            currentConfig = JSON.parse(data);
        } catch {
            currentConfig = {
                basePrompt: "",
                internalPrompt: "",
                businessPrompt: "",
                otherPrompt: "",
                terminology: "",
                history: []
            };
        }

        // 履歴を更新（最新の現在の状態を履歴の先頭に追加）
        const history = currentConfig.history || [];
        const { history: _, ...oldStateWithoutHistory } = currentConfig;

        // 前回の内容が空でなければ履歴に追加
        if (oldStateWithoutHistory.basePrompt || oldStateWithoutHistory.internalPrompt) {
            history.unshift(oldStateWithoutHistory);
        }

        // 履歴は最大10件保持
        const updatedHistory = history.slice(0, 10);

        // 新しい設定を作成
        const finalConfig: PromptConfig = {
            ...newConfig,
            updatedBy: session.user?.name || "不明なユーザー",
            updatedAt: new Date().toISOString(),
            history: updatedHistory
        };

        await fs.writeFile(PROMPTS_FILE, JSON.stringify(finalConfig, null, 2), "utf-8");
        return NextResponse.json({ success: true, config: finalConfig });
    } catch (error) {
        console.error("Save prompts error:", error);
        return NextResponse.json(
            { error: "設定の保存に失敗しました" },
            { status: 500 }
        );
    }
}
