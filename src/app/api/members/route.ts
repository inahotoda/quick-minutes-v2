import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { getTenantConfig, saveTenantConfig } from "@/lib/supabase";

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

export async function GET() {
    try {
        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) return NextResponse.json({ members: [] });

        const config = await getTenantConfig(tenant.tenantId, "members");
        if (config?.data) {
            const membersData = config.data as MembersConfig;
            return NextResponse.json({ members: membersData.members || [] });
        }
        return NextResponse.json({ members: [] });
    } catch (error) {
        console.error("GET /api/members error:", error);
        return NextResponse.json({ members: [] });
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

        const { members } = await request.json();

        const config: MembersConfig = {
            members: members || [],
            updatedAt: new Date().toISOString(),
        };
        await saveTenantConfig(tenant.tenantId, "members", config, tenant.userName);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("POST /api/members error:", error);
        return NextResponse.json(
            { error: error.message || "保存に失敗しました" },
            { status: 500 }
        );
    }
}
