import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { knowledgeDb } from "@/lib/supabase";

function toMemberData(row: any, nameVariants?: string[]) {
    const member: any = {
        id: row.external_id || row.id,
        name: row.name,
        nameVariants: nameVariants || undefined,
        email: row.email || null,
        company: row.company_name || null,
        department: row.department || null,
        role: row.role || null,
        type: row.type || "internal",
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

/** external_id または UUID でメンバーを検索 */
async function findMember(tenantId: string, id: string) {
    if (!knowledgeDb) return null;

    // external_id で検索
    const { data: byExtId } = await knowledgeDb
        .from("members")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("external_id", id)
        .eq("is_active", true)
        .limit(1);

    if (byExtId && byExtId.length > 0) return byExtId[0];

    // UUID で検索
    const { data: byUuid } = await knowledgeDb
        .from("members")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .eq("is_active", true)
        .limit(1);

    return byUuid && byUuid.length > 0 ? byUuid[0] : null;
}

/** GET /api/members/[id] - 単一メンバー取得 */
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } },
) {
    try {
        if (!knowledgeDb) return NextResponse.json({ member: null }, { status: 404 });

        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) {
            return NextResponse.json({ member: null }, { status: 404 });
        }

        const row = await findMember(tenant.tenantId, params.id);
        if (!row) return NextResponse.json({ member: null }, { status: 404 });

        const { data: variants } = await knowledgeDb
            .from("member_name_variants")
            .select("name")
            .eq("member_id", row.id);

        return NextResponse.json({
            member: toMemberData(row, (variants || []).map((v: any) => v.name)),
        });
    } catch (error) {
        console.error("GET /api/members/[id] error:", error);
        return NextResponse.json({ member: null }, { status: 500 });
    }
}

/** PUT /api/members/[id] - メンバー更新 */
export async function PUT(
    request: NextRequest,
    { params }: { params: { id: string } },
) {
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

        const row = await findMember(tenant.tenantId, params.id);
        if (!row) return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });

        const body = await request.json();
        const updates: any = { updated_at: new Date().toISOString() };

        if (body.name !== undefined) updates.name = body.name;
        if (body.email !== undefined) updates.email = body.email || null;
        if (body.company !== undefined) updates.company_name = body.company || null;
        if (body.department !== undefined) updates.department = body.department || null;
        if (body.role !== undefined) updates.role = body.role || null;
        if (body.type !== undefined) {
            updates.type = body.type === "external" ? "client" : (body.type || "internal");
        }
        if (body.voiceSample) {
            updates.voice_sample_base64 = body.voiceSample.blobBase64;
            updates.voice_sample_duration = body.voiceSample.duration;
            updates.voice_sample_recorded_at = body.voiceSample.recordedAt;
        }

        await knowledgeDb.from("members").update(updates).eq("id", row.id);

        // name_variants を同期
        if (body.nameVariants !== undefined) {
            await knowledgeDb.from("member_name_variants").delete().eq("member_id", row.id);
            if (body.nameVariants && body.nameVariants.length > 0) {
                await knowledgeDb.from("member_name_variants").insert(
                    body.nameVariants.map((name: string) => ({ member_id: row.id, name })),
                );
            }
        }

        // 更新後のデータを返却
        const { data: updated } = await knowledgeDb
            .from("members").select("*").eq("id", row.id).single();
        const { data: variants } = await knowledgeDb
            .from("member_name_variants").select("name").eq("member_id", row.id);

        return NextResponse.json({
            member: toMemberData(updated, (variants || []).map((v: any) => v.name)),
        });
    } catch (error: any) {
        console.error("PUT /api/members/[id] error:", error);
        return NextResponse.json(
            { error: error.message || "更新に失敗しました" },
            { status: 500 },
        );
    }
}

/** DELETE /api/members/[id] - メンバー削除（論理削除） */
export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } },
) {
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

        const row = await findMember(tenant.tenantId, params.id);
        if (!row) return NextResponse.json({ error: "メンバーが見つかりません" }, { status: 404 });

        await knowledgeDb
            .from("members")
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq("id", row.id);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("DELETE /api/members/[id] error:", error);
        return NextResponse.json(
            { error: error.message || "削除に失敗しました" },
            { status: 500 },
        );
    }
}
