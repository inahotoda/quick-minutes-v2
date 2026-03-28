import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { getTenantConfig, saveTenantConfig } from "@/lib/supabase";
import { loadTerminologyText, saveTerminologyFromText } from "@/lib/knowledge-terminology";
import {
    DEFAULT_BASE_PROMPT,
    DEFAULT_INTERNAL_PROMPT,
    DEFAULT_BUSINESS_PROMPT,
    DEFAULT_OTHER_PROMPT,
} from "@/lib/default-prompts";

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
    basePrompt: DEFAULT_BASE_PROMPT,
    internalPrompt: DEFAULT_INTERNAL_PROMPT,
    businessPrompt: DEFAULT_BUSINESS_PROMPT,
    otherPrompt: DEFAULT_OTHER_PROMPT,
    terminology: "",
    history: []
};

export async function GET() {
    try {
        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) return NextResponse.json(DEFAULT_CONFIG);

        // プロンプト設定は tenant_configs から取得
        const config = await getTenantConfig(tenant.tenantId, "prompts");
        const saved = config?.data as PromptConfig | undefined;

        // DB に保存済みの値があればそれを使い、なければデフォルト
        const promptData = {
            basePrompt: saved?.basePrompt || DEFAULT_CONFIG.basePrompt,
            internalPrompt: saved?.internalPrompt || DEFAULT_CONFIG.internalPrompt,
            businessPrompt: saved?.businessPrompt || DEFAULT_CONFIG.businessPrompt,
            otherPrompt: saved?.otherPrompt || DEFAULT_CONFIG.otherPrompt,
            updatedBy: saved?.updatedBy,
            updatedAt: saved?.updatedAt,
            history: saved?.history || [],
        };

        // terminology は knowledge スキーマから取得
        const terminology = await loadTerminologyText(tenant.tenantId);

        return NextResponse.json({
            ...promptData,
            terminology,
        });
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

        // terminology は knowledge スキーマに保存
        if (newConfig.terminology !== undefined) {
            await saveTerminologyFromText(tenant.tenantId, newConfig.terminology);
        }

        // プロンプト部分は tenant_configs に保存（terminology は除外）
        const currentConfigData = await getTenantConfig(tenant.tenantId, "prompts");
        const currentConfig: PromptConfig = (currentConfigData?.data as PromptConfig) || DEFAULT_CONFIG;

        const history = currentConfig.history || [];
        const { history: _, terminology: _t, ...oldStateWithoutHistory } = currentConfig as any;
        if (oldStateWithoutHistory.basePrompt || oldStateWithoutHistory.internalPrompt) {
            history.unshift(oldStateWithoutHistory);
        }

        const finalConfig = {
            basePrompt: newConfig.basePrompt ?? currentConfig.basePrompt,
            internalPrompt: newConfig.internalPrompt ?? currentConfig.internalPrompt,
            businessPrompt: newConfig.businessPrompt ?? currentConfig.businessPrompt,
            otherPrompt: newConfig.otherPrompt ?? currentConfig.otherPrompt,
            terminology: "", // knowledge スキーマに移行済み
            updatedBy: tenant.userName,
            updatedAt: new Date().toISOString(),
            history: history.slice(0, 10),
        };

        await saveTenantConfig(tenant.tenantId, "prompts", finalConfig, tenant.userName);

        return NextResponse.json({
            success: true,
            config: {
                ...finalConfig,
                terminology: newConfig.terminology || "",
            },
        });
    } catch (error: any) {
        console.error("Save prompts error:", error);
        return NextResponse.json(
            { error: error.message || "設定の保存に失敗しました" },
            { status: 500 }
        );
    }
}
