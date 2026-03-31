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
    nameVariants?: string[];
    email?: string | null;
    company?: string | null;
    department?: string | null;
    role?: string | null;
    type?: string;
    voiceSample?: VoiceSampleData;
    createdAt: string;
    updatedAt: string;
}

/** knowledge.members → フロント互換の MemberData に変換 */
function toMemberData(row: any, nameVariantsMap?: Map<string, string[]>): MemberData {
    const member: MemberData = {
        id: row.external_id || row.id,
        name: row.name,
        nameVariants: nameVariantsMap?.get(row.id) || undefined,
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

        // Deduplicate by external_id: if duplicate rows exist (from past race conditions),
        // keep only the most recently updated one per external_id
        const seen = new Map<string, any>();
        const deduped: any[] = [];
        for (const row of data || []) {
            const key = row.external_id || row.id;
            const existing = seen.get(key);
            if (existing) {
                // Keep the one with the later updated_at
                if (row.updated_at > existing.updated_at) {
                    deduped[deduped.indexOf(existing)] = row;
                    seen.set(key, row);
                }
            } else {
                seen.set(key, row);
                deduped.push(row);
            }
        }

        // name_variants を取得
        const memberIds = deduped.map((m: any) => m.id);
        const nameVariantsMap = new Map<string, string[]>();
        if (memberIds.length > 0) {
            const { data: variants } = await knowledgeDb
                .from("member_name_variants")
                .select("member_id, name")
                .in("member_id", memberIds);
            for (const v of variants || []) {
                const list = nameVariantsMap.get(v.member_id) || [];
                list.push(v.name);
                nameVariantsMap.set(v.member_id, list);
            }
        }

        return NextResponse.json({
            members: deduped.map((row: any) => toMemberData(row, nameVariantsMap)),
        });
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

        // Build a map of external_id → primary row, and collect duplicate row IDs
        const existingByExtId = new Map<string, any>();
        const duplicateRowIds: string[] = [];
        for (const m of (existing || []).filter((m: any) => m.external_id)) {
            if (existingByExtId.has(m.external_id)) {
                // Duplicate: mark for deactivation
                duplicateRowIds.push(m.id);
            } else {
                existingByExtId.set(m.external_id, m);
            }
        }
        const incomingExtIds = new Set(members.map(m => m.id));

        // 削除されたメンバーを is_active=false に
        const removedRows = (existing || []).filter(
            (m: any) => m.external_id && !incomingExtIds.has(m.external_id)
        );
        // Also deactivate duplicate rows
        const deactivateIds = [
            ...removedRows.map((m: any) => m.id),
            ...duplicateRowIds,
        ];
        if (deactivateIds.length > 0) {
            await knowledgeDb
                .from("members")
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .in("id", deactivateIds);
        }

        // 各メンバーを upsert
        for (const member of members) {
            const row: any = {
                tenant_id: tenant.tenantId,
                name: member.name,
                external_id: member.id,
                email: member.email || null,
                type: member.type || "internal",
                company_name: member.company || null,
                department: member.department || null,
                role: member.role || null,
                is_active: true,
                updated_at: new Date().toISOString(),
            };

            if (member.voiceSample) {
                row.voice_sample_base64 = member.voiceSample.blobBase64;
                row.voice_sample_duration = member.voiceSample.duration;
                row.voice_sample_recorded_at = member.voiceSample.recordedAt;
            }

            const existingRow = existingByExtId.get(member.id);
            let memberUuid: string;

            if (existingRow) {
                await knowledgeDb
                    .from("members")
                    .update(row)
                    .eq("id", existingRow.id);
                memberUuid = existingRow.id;
            } else {
                row.created_at = member.createdAt || new Date().toISOString();
                const { data: inserted } = await knowledgeDb
                    .from("members")
                    .insert(row)
                    .select("id")
                    .single();
                memberUuid = inserted?.id;
            }

            // name_variants を同期
            if (memberUuid && member.nameVariants && member.nameVariants.length > 0) {
                await knowledgeDb
                    .from("member_name_variants")
                    .delete()
                    .eq("member_id", memberUuid);
                await knowledgeDb
                    .from("member_name_variants")
                    .insert(
                        member.nameVariants.map((name: string) => ({
                            member_id: memberUuid,
                            name,
                        }))
                    );
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
