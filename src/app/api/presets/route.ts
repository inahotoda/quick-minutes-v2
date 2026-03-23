import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { getTenantConfig, saveTenantConfig } from "@/lib/supabase";

interface PresetData {
    id: string;
    name: string;
    mode: "internal" | "business" | "other";
    duration?: 30 | 60 | 0;
    memberIds: string[];
    createdAt: string;
    updatedAt: string;
}

interface PresetsConfig {
    presets: PresetData[];
    updatedAt: string;
}

export async function GET() {
    try {
        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) return NextResponse.json({ presets: [] });

        const config = await getTenantConfig(tenant.tenantId, "presets");
        if (config?.data) {
            const presetsData = config.data as PresetsConfig;
            return NextResponse.json({ presets: presetsData.presets || [] });
        }
        return NextResponse.json({ presets: [] });
    } catch (error) {
        console.error("GET /api/presets error:", error);
        return NextResponse.json({ presets: [] });
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

        const { presets } = await request.json();

        const config: PresetsConfig = {
            presets: presets || [],
            updatedAt: new Date().toISOString(),
        };
        await saveTenantConfig(tenant.tenantId, "presets", config, tenant.userName);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("POST /api/presets error:", error);
        return NextResponse.json(
            { error: error.message || "保存に失敗しました" },
            { status: 500 }
        );
    }
}
