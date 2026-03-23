import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { getTenantConfig, saveTenantConfig } from "@/lib/supabase";

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

export async function GET() {
    try {
        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) return NextResponse.json(DEFAULT_CONFIG);

        const config = await getTenantConfig(tenant.tenantId, "prompts");
        if (config?.data) {
            return NextResponse.json(config.data);
        }
        return NextResponse.json(DEFAULT_CONFIG);
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

        const { tenant, error, statusCode } = await resolveTenantPlan();
        if (error) return NextResponse.json({ error }, { status: statusCode || 403 });
        if (!tenant) return NextResponse.json({ error: "テナントが見つかりません" }, { status: 403 });
        if (tenant.expired) return NextResponse.json({ error: "利用期間が終了しています" }, { status: 403 });

        const newConfig = await request.json();

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
    } catch (error: any) {
        console.error("Save prompts error:", error);
        return NextResponse.json(
            { error: error.message || "設定の保存に失敗しました" },
            { status: 500 }
        );
    }
}
