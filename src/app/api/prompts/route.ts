import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findFileByName, getFileContent, updateFile, uploadFile } from "@/lib/drive";
import { resolveTenant } from "@/lib/tenant";
import { getTenantConfig, saveTenantConfig, isTrialMode } from "@/lib/supabase";

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
        console.log("getMergedConfig: searching for", PROMPTS_FILENAME);
        const file = await findFileByName(PROMPTS_FILENAME, CONFIG_FOLDER_ID);
        if (file && file.id) {
            console.log("getMergedConfig: found file in drive, ID:", file.id);
            const content = await getFileContent(file.id);
            if (content && content.trim()) {
                try {
                    return JSON.parse(content);
                } catch (pe) {
                    console.error("getMergedConfig: JSON parse error", pe);
                }
            }
        }

        console.log("getMergedConfig: falling back to local file");
        const data = await fs.readFile(LOCAL_PROMPTS_FILE, "utf-8");
        return JSON.parse(data);
    } catch (error) {
        console.log("getMergedConfig: error, returning DEFAULT_CONFIG", error);
        return DEFAULT_CONFIG;
    }
}

export async function GET() {
    try {
        // ── Trial mode: Supabase ──
        if (isTrialMode()) {
            const { tenant, error } = await resolveTenant();
            if (error || !tenant || tenant.expired) return NextResponse.json(DEFAULT_CONFIG);

            const config = await getTenantConfig(tenant.tenantId, "prompts");
            if (config?.data) {
                return NextResponse.json(config.data);
            }
            return NextResponse.json(DEFAULT_CONFIG);
        }

        // ── Normal mode: Google Drive ──
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

        // ── Trial mode: Supabase ──
        if (isTrialMode()) {
            const { tenant, error, statusCode } = await resolveTenant();
            if (error) return NextResponse.json({ error }, { status: statusCode || 403 });
            if (!tenant) return NextResponse.json({ error: "テナントが見つかりません" }, { status: 403 });
            if (tenant.expired) return NextResponse.json({ error: "モニター期間が終了しています" }, { status: 403 });

            const currentConfigData = await getTenantConfig(tenant.tenantId, "prompts");
            const currentConfig: PromptConfig = (currentConfigData?.data as PromptConfig) || DEFAULT_CONFIG;

            const history = currentConfig.history || [];
            const { history: _, ...oldStateWithoutHistory } = currentConfig;
            if (oldStateWithoutHistory.basePrompt || oldStateWithoutHistory.internalPrompt) {
                history.unshift(oldStateWithoutHistory);
            }

            const finalConfig: PromptConfig = {
                ...newConfig,
                updatedBy: tenant.userName,
                updatedAt: new Date().toISOString(),
                history: history.slice(0, 10),
            };

            await saveTenantConfig(tenant.tenantId, "prompts", finalConfig, tenant.userName);
            return NextResponse.json({ success: true, config: finalConfig });
        }

        // ── Normal mode: Google Drive ──
        console.log("POST /api/prompts: received new config");

        const currentConfig = await getMergedConfig();

        const history = currentConfig.history || [];
        const { history: _, ...oldStateWithoutHistory } = currentConfig;

        if (oldStateWithoutHistory.basePrompt || oldStateWithoutHistory.internalPrompt) {
            history.unshift(oldStateWithoutHistory);
        }
        const updatedHistory = history.slice(0, 10);

        const finalConfig: PromptConfig = {
            ...newConfig,
            updatedBy: session.user?.name || "不明なユーザー",
            updatedAt: new Date().toISOString(),
            history: updatedHistory
        };

        const configContent = JSON.stringify(finalConfig, null, 2);

        console.log("POST /api/prompts: saving to Google Drive...");
        const file = await findFileByName(PROMPTS_FILENAME, CONFIG_FOLDER_ID);
        if (file && file.id) {
            console.log("POST /api/prompts: updating existing file", file.id);
            await updateFile(file.id, configContent, "application/json");
        } else {
            console.log("POST /api/prompts: creating new file in folder", CONFIG_FOLDER_ID);
            const base64 = Buffer.from(configContent).toString("base64");
            await uploadFile(PROMPTS_FILENAME, base64, "application/json", CONFIG_FOLDER_ID);
        }

        console.log("POST /api/prompts: save successful");
        return NextResponse.json({ success: true, config: finalConfig });
    } catch (error: any) {
        console.error("Save prompts error:", error);
        return NextResponse.json(
            { error: error.message || "設定の保存に失敗しました" },
            { status: 500 }
        );
    }
}
