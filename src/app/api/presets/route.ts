import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { knowledgeDb } from "@/lib/supabase";

interface PresetData {
    id: string;
    name: string;
    mode: "internal" | "business" | "other";
    duration?: 30 | 60 | 0;
    memberIds: string[];
    additionalPrompt?: string;
    isArchived?: boolean;
    lastUsedAt?: string;
    usageCount?: number;
    createdAt: string;
    updatedAt: string;
}

/** knowledge.meeting_presets → フロント互換の PresetData に変換 */
function toPresetData(row: any, memberExtIdMap: Map<string, string>): PresetData {
    // preset_members の source_id (UUID) → external_id (QM形式) に変換
    const memberIds = (row.preset_members || [])
        .filter((pm: any) => pm.source === "member")
        .map((pm: any) => memberExtIdMap.get(pm.source_id) || pm.source_id);

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

export async function GET() {
    try {
        if (!knowledgeDb) return NextResponse.json({ presets: [] });

        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) return NextResponse.json({ presets: [] });

        // プリセット + メンバー紐付けを取得
        // アーカイブ済みも含めて全件返す（フロントでタブ分離表示）
        const { data, error: dbError } = await knowledgeDb
            .from("meeting_presets")
            .select("*, preset_members(*)")
            .eq("tenant_id", tenant.tenantId)
            .order("name");

        if (dbError) {
            console.error("GET /api/presets error:", dbError);
            return NextResponse.json({ presets: [] });
        }

        // メンバーの UUID → external_id マッピング取得
        const { data: members } = await knowledgeDb
            .from("members")
            .select("id, external_id")
            .eq("tenant_id", tenant.tenantId);

        const memberExtIdMap = new Map(
            (members || [])
                .filter((m: any) => m.external_id)
                .map((m: any) => [m.id, m.external_id])
        );

        return NextResponse.json({
            presets: (data || []).map(row => toPresetData(row, memberExtIdMap)),
        });
    } catch (error) {
        console.error("GET /api/presets error:", error);
        return NextResponse.json({ presets: [] });
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

        const { presets } = await request.json() as { presets: PresetData[] };

        // external_id → knowledge UUID マッピング（メンバー）
        const { data: members } = await knowledgeDb
            .from("members")
            .select("id, external_id")
            .eq("tenant_id", tenant.tenantId);

        const memberUuidMap = new Map(
            (members || [])
                .filter((m: any) => m.external_id)
                .map((m: any) => [m.external_id, m.id])
        );

        // 既存プリセット取得
        const { data: existingPresets } = await knowledgeDb
            .from("meeting_presets")
            .select("id, external_id")
            .eq("tenant_id", tenant.tenantId);

        const existingByExtId = new Map(
            (existingPresets || [])
                .filter((p: any) => p.external_id)
                .map((p: any) => [p.external_id, p])
        );
        const incomingExtIds = new Set(presets.map(p => p.id));

        // 削除されたプリセットを archive
        const removedRows = (existingPresets || []).filter(
            (p: any) => p.external_id && !incomingExtIds.has(p.external_id)
        );
        if (removedRows.length > 0) {
            await knowledgeDb
                .from("meeting_presets")
                .update({ is_archived: true, updated_at: new Date().toISOString() })
                .in("id", removedRows.map((p: any) => p.id));
        }

        // 各プリセットを upsert
        for (const preset of presets) {
            const row: any = {
                tenant_id: tenant.tenantId,
                name: preset.name,
                external_id: preset.id,
                mode: preset.mode || "internal",
                duration_min: preset.duration || null,
                additional_prompt: preset.additionalPrompt || null,
                is_archived: false,
                last_used_at: preset.lastUsedAt || null,
                usage_count: preset.usageCount || 0,
                updated_at: new Date().toISOString(),
            };

            let presetUuid: string;
            const existingRow = existingByExtId.get(preset.id);

            if (existingRow) {
                await knowledgeDb
                    .from("meeting_presets")
                    .update(row)
                    .eq("id", existingRow.id);
                presetUuid = existingRow.id;
            } else {
                row.created_at = preset.createdAt || new Date().toISOString();
                const { data: inserted } = await knowledgeDb
                    .from("meeting_presets")
                    .insert(row)
                    .select("id")
                    .single();
                presetUuid = inserted?.id;
            }

            if (!presetUuid) continue;

            // preset_members を再構築
            await knowledgeDb
                .from("preset_members")
                .delete()
                .eq("preset_id", presetUuid);

            const memberRows = (preset.memberIds || [])
                .map(extId => {
                    const uuid = memberUuidMap.get(extId);
                    if (!uuid) return null;
                    return {
                        preset_id: presetUuid,
                        source: "member",
                        source_id: uuid,
                        role: "participant",
                    };
                })
                .filter(Boolean);

            if (memberRows.length > 0) {
                await knowledgeDb
                    .from("preset_members")
                    .insert(memberRows);
            }
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("POST /api/presets error:", error);
        return NextResponse.json(
            { error: error.message || "保存に失敗しました" },
            { status: 500 }
        );
    }
}
