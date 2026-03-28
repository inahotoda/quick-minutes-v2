import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { knowledgeDb } from "@/lib/supabase";

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

/** knowledge.members → フロント互換の MemberData に変換 */
function toMemberData(row: any): MemberData {
    const member: MemberData = {
        id: row.external_id || row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
    if (row.voice_sample_base64) {
        member.voiceSample = {
            blobBase64: row.voice_sample_base64,
            duration: row.voice_sample_duration || 0,
            recordedAt: row.voice_sample_recorded_at || row.updated_at,
        };
    }
    return member;
}

export async function GET() {
    try {
        if (!knowledgeDb) return NextResponse.json({ members: [] });

        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) return NextResponse.json({ members: [] });

        const { data, error: dbError } = await knowledgeDb
            .from("members")
            .select("*")
            .eq("tenant_id", tenant.tenantId)
            .eq("is_active", true)
            .order("name");

        if (dbError) {
            console.error("GET /api/members error:", dbError);
            return NextResponse.json({ members: [] });
        }

        return NextResponse.json({ members: (data || []).map(toMemberData) });
    } catch (error) {
        console.error("GET /api/members error:", error);
        return NextResponse.json({ members: [] });
    }
}

export async function POST(request: NextRequest) {
    try {
        if (!knowledgeDb) {
            return NextResponse.json({ error: "DB not configured" }, { status: 500 });
        }

        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const { tenant, error, statusCode } = await resolveTenantPlan();
        if (error) return NextResponse.json({ error }, { status: statusCode || 403 });
        if (!tenant) return NextResponse.json({ error: "テナントが見つかりません" }, { status: 403 });
        if (tenant.expired) return NextResponse.json({ error: "利用期間が終了しています" }, { status: 403 });

        const { members } = await request.json() as { members: MemberData[] };

        // 現在のメンバーを取得（external_id でマッチ）
        const { data: existing } = await knowledgeDb
            .from("members")
            .select("id, external_id, name")
            .eq("tenant_id", tenant.tenantId);

        const existingByExtId = new Map(
            (existing || [])
                .filter((m: any) => m.external_id)
                .map((m: any) => [m.external_id, m])
        );
        const incomingExtIds = new Set(members.map(m => m.id));

        // 削除されたメンバーを is_active=false に
        const removedRows = (existing || []).filter(
            (m: any) => m.external_id && !incomingExtIds.has(m.external_id)
        );
        if (removedRows.length > 0) {
            await knowledgeDb
                .from("members")
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .in("id", removedRows.map((m: any) => m.id));
        }

        // 各メンバーを upsert
        for (const member of members) {
            const row: any = {
                tenant_id: tenant.tenantId,
                name: member.name,
                external_id: member.id,
                is_active: true,
                updated_at: new Date().toISOString(),
            };

            if (member.voiceSample) {
                row.voice_sample_base64 = member.voiceSample.blobBase64;
                row.voice_sample_duration = member.voiceSample.duration;
                row.voice_sample_recorded_at = member.voiceSample.recordedAt;
            }

            const existingRow = existingByExtId.get(member.id);
            if (existingRow) {
                await knowledgeDb
                    .from("members")
                    .update(row)
                    .eq("id", existingRow.id);
            } else {
                row.created_at = member.createdAt || new Date().toISOString();
                await knowledgeDb
                    .from("members")
                    .insert(row);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("POST /api/members error:", error);
        return NextResponse.json(
            { error: error.message || "保存に失敗しました" },
            { status: 500 }
        );
    }
}
