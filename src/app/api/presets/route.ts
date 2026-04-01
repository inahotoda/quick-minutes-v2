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
    // 重複メンバー（同じexternal_idを指す複数UUID）を排除
    const memberIds = [...new Set(
        (row.preset_members || [])
            .filter((pm: any) => pm.source === "member")
            .map((pm: any) => memberExtIdMap.get(pm.source_id) || pm.source_id)
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

        // ============================================================
        // プリセット重複排除（2段階）
        // Step 1: external_id が同一の重複を排除
        // Step 2: name が同一の重複を排除（同名プリセット）
        // ============================================================
        const duplicatePresetIds: string[] = [];

        // Step 1: external_id ベースの重複排除
        const seenByExtId = new Map<string, any>();
        const afterExtIdDedup: any[] = [];
        for (const row of data || []) {
            const extId = row.external_id;
            if (extId) {
                const existing = seenByExtId.get(extId);
                if (existing) {
                    if (row.updated_at > existing.updated_at) {
                        duplicatePresetIds.push(existing.id);
                        afterExtIdDedup[afterExtIdDedup.indexOf(existing)] = row;
                        seenByExtId.set(extId, row);
                    } else {
                        duplicatePresetIds.push(row.id);
                    }
                } else {
                    seenByExtId.set(extId, row);
                    afterExtIdDedup.push(row);
                }
            } else {
                afterExtIdDedup.push(row);
            }
        }

        // Step 2: name + is_archived ベースの重複排除
        // 同名プリセット（同じアーカイブ状態）は1つに統合
        const seenByName = new Map<string, any>();
        const dedupedPresets: any[] = [];
        for (const row of afterExtIdDedup) {
            const nameKey = `${row.name.trim().toLowerCase()}__${row.is_archived ? 'archived' : 'active'}`;
            const existing = seenByName.get(nameKey);
            if (existing) {
                // usage_count が多い方を優先、同等なら updated_at が新しい方
                const keepNew = (row.usage_count || 0) > (existing.usage_count || 0) ||
                    ((row.usage_count || 0) === (existing.usage_count || 0) && row.updated_at > existing.updated_at);
                if (keepNew) {
                    duplicatePresetIds.push(existing.id);
                    dedupedPresets[dedupedPresets.indexOf(existing)] = row;
                    seenByName.set(nameKey, row);
                } else {
                    duplicatePresetIds.push(row.id);
                }
            } else {
                seenByName.set(nameKey, row);
                dedupedPresets.push(row);
            }
        }

        // Auto-cleanup: 重複プリセットをDBから非同期でアーカイブ
        if (duplicatePresetIds.length > 0) {
            knowledgeDb
                .from("meeting_presets")
                .update({ is_archived: true, updated_at: new Date().toISOString() })
                .in("id", duplicatePresetIds)
                .then(() => {
                    console.log(`Cleaned up ${duplicatePresetIds.length} duplicate preset row(s)`);
                })
                .catch((err: any) => {
                    console.error("Failed to cleanup duplicate presets:", err);
                });
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
            presets: dedupedPresets.map(row => toPresetData(row, memberExtIdMap)),
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

        // external_id → UUID マッピング（重複がある場合は最初のものを使用）
        const memberUuidMap = new Map<string, string>();
        for (const m of (members || []).filter((m: any) => m.external_id)) {
            if (!memberUuidMap.has(m.external_id)) {
                memberUuidMap.set(m.external_id, m.id);
            }
        }

        // 既存プリセット取得
        const { data: existingPresets } = await knowledgeDb
            .from("meeting_presets")
            .select("id, external_id")
            .eq("tenant_id", tenant.tenantId);

        // Build a map of external_id → primary row, and collect duplicate row IDs
        const existingByExtId = new Map<string, any>();
        const duplicatePresetRowIds: string[] = [];
        for (const p of (existingPresets || []).filter((p: any) => p.external_id)) {
            if (existingByExtId.has(p.external_id)) {
                duplicatePresetRowIds.push(p.id);
            } else {
                existingByExtId.set(p.external_id, p);
            }
        }
        const incomingExtIds = new Set(presets.map(p => p.id));

        // 削除されたプリセットを archive + 重複行もアーカイブ
        const removedRows = (existingPresets || []).filter(
            (p: any) => p.external_id && !incomingExtIds.has(p.external_id)
        );
        const archiveIds = [
            ...removedRows.map((p: any) => p.id),
            ...duplicatePresetRowIds,
        ];
        if (archiveIds.length > 0) {
            await knowledgeDb
                .from("meeting_presets")
                .update({ is_archived: true, updated_at: new Date().toISOString() })
                .in("id", archiveIds);
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
