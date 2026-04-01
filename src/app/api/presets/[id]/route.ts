import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { knowledgeDb } from "@/lib/supabase";

/** external_id または UUID でプリセットを検索 */
async function findPreset(tenantId: string, id: string) {
    if (!knowledgeDb) return null;

    const { data: byExtId } = await knowledgeDb
        .from("meeting_presets")
        .select("*, preset_members(*)")
        .eq("tenant_id", tenantId)
        .eq("external_id", id)
        .limit(1);

    if (byExtId && byExtId.length > 0) return byExtId[0];

    const { data: byUuid } = await knowledgeDb
        .from("meeting_presets")
        .select("*, preset_members(*)")
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .limit(1);

    return byUuid && byUuid.length > 0 ? byUuid[0] : null;
}

/** メンバー UUID → フロントID (external_id || uuid) マッピング取得 */
async function getMemberIdMap(tenantId: string): Promise<Map<string, string>> {
    if (!knowledgeDb) return new Map();
    const { data: members } = await knowledgeDb
        .from("members")
        .select("id, external_id")
        .eq("tenant_id", tenantId);

    const map = new Map<string, string>();
    for (const m of members || []) {
        map.set(m.id, m.external_id || m.id);
    }
    return map;
}

/** フロントID (external_id || uuid) → メンバー UUID マッピング取得 */
async function getMemberUuidMap(tenantId: string): Promise<Map<string, string>> {
    if (!knowledgeDb) return new Map();
    const { data: members } = await knowledgeDb
        .from("members")
        .select("id, external_id")
        .eq("tenant_id", tenantId);

    const map = new Map<string, string>();
    for (const m of members || []) {
        map.set(m.id, m.id); // UUID → UUID
        if (m.external_id) {
            map.set(m.external_id, m.id); // external_id → UUID
        }
    }
    return map;
}

function toPresetData(row: any, memberIdMap: Map<string, string>) {
    const memberIds = [...new Set(
        (row.preset_members || [])
            .filter((pm: any) => pm.source === "member")
            .map((pm: any) => memberIdMap.get(pm.source_id) || pm.source_id),
    )];

    return {
        id: row.external_id || row.id,
        name: row.name,
        mode: row.mode || "internal",
        duration: row.duration_min || 0,
        memberIds,
        additionalPrompt: row.additional_prompt || undefined,
        isArchived: row.is_archived || false,
        lastUsedAt: row.last_used_at || undefined,
        usageCount: row.usage_count || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/** GET /api/presets/[id] - 単一プリセット取得 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        if (!knowledgeDb) return NextResponse.json({ preset: null }, { status: 404 });

        const { id } = await params;
        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) {
            return NextResponse.json({ preset: null }, { status: 404 });
        }

        const row = await findPreset(tenant.tenantId, id);
        if (!row) return NextResponse.json({ preset: null }, { status: 404 });

        const memberIdMap = await getMemberIdMap(tenant.tenantId);

        return NextResponse.json({ preset: toPresetData(row, memberIdMap) });
    } catch (error) {
        console.error("GET /api/presets/[id] error:", error);
        return NextResponse.json({ preset: null }, { status: 500 });
    }
}

/** PUT /api/presets/[id] - プリセット更新 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        if (!knowledgeDb) {
            return NextResponse.json({ error: "DB not configured" }, { status: 500 });
        }

        const { id } = await params;
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const { tenant, error, statusCode } = await resolveTenantPlan();
        if (error) return NextResponse.json({ error }, { status: statusCode || 403 });
        if (!tenant) return NextResponse.json({ error: "テナントが見つかりません" }, { status: 403 });

        const row = await findPreset(tenant.tenantId, id);
        if (!row) return NextResponse.json({ error: "プリセットが見つかりません" }, { status: 404 });

        const body = await request.json();
        const updates: any = { updated_at: new Date().toISOString() };

        if (body.name !== undefined) updates.name = body.name;
        if (body.mode !== undefined) updates.mode = body.mode;
        if (body.duration !== undefined) updates.duration_min = body.duration || null;
        if (body.additionalPrompt !== undefined) updates.additional_prompt = body.additionalPrompt || null;
        if (body.isArchived !== undefined) updates.is_archived = body.isArchived;
        if (body.lastUsedAt !== undefined) updates.last_used_at = body.lastUsedAt;
        if (body.usageCount !== undefined) updates.usage_count = body.usageCount;

        await knowledgeDb.from("meeting_presets").update(updates).eq("id", row.id);

        // memberIds が指定された場合は preset_members を再構築
        if (body.memberIds !== undefined) {
            await knowledgeDb.from("preset_members").delete().eq("preset_id", row.id);

            const memberUuidMap = await getMemberUuidMap(tenant.tenantId);
            const memberRows = (body.memberIds || [])
                .map((frontId: string) => {
                    const uuid = memberUuidMap.get(frontId);
                    if (!uuid) return null;
                    return {
                        preset_id: row.id,
                        source: "member",
                        source_id: uuid,
                        role: "participant",
                    };
                })
                .filter(Boolean);

            if (memberRows.length > 0) {
                await knowledgeDb.from("preset_members").insert(memberRows);
            }
        }

        // 更新後のデータを返却
        const updated = await findPreset(tenant.tenantId, id);
        const memberIdMap = await getMemberIdMap(tenant.tenantId);

        return NextResponse.json({ preset: toPresetData(updated, memberIdMap) });
    } catch (error: any) {
        console.error("PUT /api/presets/[id] error:", error);
        return NextResponse.json(
            { error: error.message || "更新に失敗しました" },
            { status: 500 },
        );
    }
}

/** DELETE /api/presets/[id] - プリセット削除 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    try {
        if (!knowledgeDb) {
            return NextResponse.json({ error: "DB not configured" }, { status: 500 });
        }

        const { id } = await params;
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const { tenant, error, statusCode } = await resolveTenantPlan();
        if (error) return NextResponse.json({ error }, { status: statusCode || 403 });
        if (!tenant) return NextResponse.json({ error: "テナントが見つかりません" }, { status: 403 });

        // external_id or UUID で検索（preset_members不要なので直接検索）
        let row: any = null;
        const { data: byExtId } = await knowledgeDb
            .from("meeting_presets")
            .select("id")
            .eq("tenant_id", tenant.tenantId)
            .eq("external_id", id)
            .limit(1);

        if (byExtId && byExtId.length > 0) {
            row = byExtId[0];
        } else {
            const { data: byUuid } = await knowledgeDb
                .from("meeting_presets")
                .select("id")
                .eq("tenant_id", tenant.tenantId)
                .eq("id", id)
                .limit(1);
            row = byUuid && byUuid.length > 0 ? byUuid[0] : null;
        }

        if (!row) return NextResponse.json({ error: "プリセットが見つかりません" }, { status: 404 });

        // preset_members も削除
        await knowledgeDb.from("preset_members").delete().eq("preset_id", row.id);
        await knowledgeDb.from("meeting_presets").delete().eq("id", row.id);

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("DELETE /api/presets/[id] error:", error);
        return NextResponse.json(
            { error: error.message || "削除に失敗しました" },
            { status: 500 },
        );
    }
}
