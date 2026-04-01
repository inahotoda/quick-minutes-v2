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
    const memberIds = [...new Set<string>(
        (row.preset_members || [])
            .filter((pm: any) => pm.source === "member")
            .map((pm: any) => memberExtIdMap.get(pm.source_id) || pm.source_id),
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

/** GET /api/presets - 全プリセット取得（重複排除付き） */
export async function GET() {
    try {
        if (!knowledgeDb) return NextResponse.json({ presets: [] });

        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) return NextResponse.json({ presets: [] });

        const { data, error: dbError } = await knowledgeDb
            .from("meeting_presets")
            .select("*, preset_members(*)")
            .eq("tenant_id", tenant.tenantId)
            .order("name");

        if (dbError) {
            console.error("GET /api/presets error:", dbError);
            return NextResponse.json({ presets: [] });
        }

        // 重複排除（2段階）
        const duplicateIds: string[] = [];

        // Step 1: external_id ベース
        const seenByExtId = new Map<string, any>();
        const afterExtIdDedup: any[] = [];
        for (const row of data || []) {
            const extId = row.external_id;
            if (extId) {
                const existing = seenByExtId.get(extId);
                if (existing) {
                    if (row.updated_at > existing.updated_at) {
                        duplicateIds.push(existing.id);
                        afterExtIdDedup[afterExtIdDedup.indexOf(existing)] = row;
                        seenByExtId.set(extId, row);
                    } else {
                        duplicateIds.push(row.id);
                    }
                } else {
                    seenByExtId.set(extId, row);
                    afterExtIdDedup.push(row);
                }
            } else {
                afterExtIdDedup.push(row);
            }
        }

        // Step 2: name + is_archived ベース
        const seenByName = new Map<string, any>();
        const dedupedPresets: any[] = [];
        for (const row of afterExtIdDedup) {
            const nameKey = `${row.name.trim().toLowerCase()}__${row.is_archived ? "archived" : "active"}`;
            const existing = seenByName.get(nameKey);
            if (existing) {
                const keepNew = (row.usage_count || 0) > (existing.usage_count || 0) ||
                    ((row.usage_count || 0) === (existing.usage_count || 0) && row.updated_at > existing.updated_at);
                if (keepNew) {
                    duplicateIds.push(existing.id);
                    dedupedPresets[dedupedPresets.indexOf(existing)] = row;
                    seenByName.set(nameKey, row);
                } else {
                    duplicateIds.push(row.id);
                }
            } else {
                seenByName.set(nameKey, row);
                dedupedPresets.push(row);
            }
        }

        // 重複行を非同期でクリーンアップ
        if (duplicateIds.length > 0) {
            (async () => {
                try {
                    await knowledgeDb
                        .from("meeting_presets")
                        .update({ is_archived: true, updated_at: new Date().toISOString() })
                        .in("id", duplicateIds);
                    console.log(`Cleaned up ${duplicateIds.length} duplicate preset row(s)`);
                } catch (err) {
                    console.error("Failed to cleanup duplicate presets:", err);
                }
            })();
        }

        // メンバー UUID → フロントID マッピング
        const { data: members } = await knowledgeDb
            .from("members")
            .select("id, external_id")
            .eq("tenant_id", tenant.tenantId);

        const memberExtIdMap = new Map<string, string>();
        for (const m of members || []) {
            memberExtIdMap.set(m.id, m.external_id || m.id);
        }

        return NextResponse.json({
            presets: dedupedPresets.map(row => toPresetData(row, memberExtIdMap)),
        });
    } catch (error) {
        console.error("GET /api/presets error:", error);
        return NextResponse.json({ presets: [] });
    }
}

/** POST /api/presets - 単一プリセット作成 */
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

        const body = await request.json();
        const name = (body.name || "").trim();
        if (!name) {
            return NextResponse.json({ error: "名前は必須です" }, { status: 400 });
        }

        const now = new Date().toISOString();
        const row: any = {
            tenant_id: tenant.tenantId,
            name,
            mode: body.mode || "internal",
            duration_min: body.duration || null,
            additional_prompt: body.additionalPrompt || null,
            is_archived: false,
            created_at: now,
            updated_at: now,
        };

        const { data: inserted, error: insertError } = await knowledgeDb
            .from("meeting_presets")
            .insert(row)
            .select("*")
            .single();

        if (insertError) {
            console.error("POST /api/presets insert error:", insertError);
            return NextResponse.json({ error: "プリセットの作成に失敗しました" }, { status: 500 });
        }

        // preset_members を構築
        if (body.memberIds && body.memberIds.length > 0) {
            // フロントID → UUID マッピング
            const { data: members } = await knowledgeDb
                .from("members")
                .select("id, external_id")
                .eq("tenant_id", tenant.tenantId);

            const memberUuidMap = new Map<string, string>();
            for (const m of members || []) {
                memberUuidMap.set(m.id, m.id);
                if (m.external_id) memberUuidMap.set(m.external_id, m.id);
            }

            const memberRows = (body.memberIds as string[])
                .map(frontId => {
                    const uuid = memberUuidMap.get(frontId);
                    if (!uuid) return null;
                    return {
                        preset_id: inserted.id,
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

        // 完成したプリセットを返却
        const { data: complete } = await knowledgeDb
            .from("meeting_presets")
            .select("*, preset_members(*)")
            .eq("id", inserted.id)
            .single();

        const { data: allMembers } = await knowledgeDb
            .from("members")
            .select("id, external_id")
            .eq("tenant_id", tenant.tenantId);

        const memberExtIdMap = new Map<string, string>();
        for (const m of allMembers || []) {
            memberExtIdMap.set(m.id, m.external_id || m.id);
        }

        return NextResponse.json({ preset: toPresetData(complete, memberExtIdMap) });
    } catch (error: any) {
        console.error("POST /api/presets error:", error);
        return NextResponse.json(
            { error: error.message || "プリセットの作成に失敗しました" },
            { status: 500 },
        );
    }
}
