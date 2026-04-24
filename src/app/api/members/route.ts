import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { knowledgeDb } from "@/lib/supabase";

/** knowledge.members → フロント互換の MemberData に変換 */
function toMemberData(row: any, nameVariantsMap?: Map<string, string[]>) {
    const member: any = {
        id: row.external_id || row.id,
        name: row.name,
        nameVariants: nameVariantsMap?.get(row.id) || undefined,
        email: row.email || null,
        company: row.company_name || row.company || null,
        department: row.department || null,
        role: row.role || null,
        type: row.type || row.member_type || "internal",
        isExternal: !!row.external_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
    // member_name_variants JOIN結果があればそちらを優先
    const variants = (row.member_name_variants || [])
        .map((v: any) => v.name)
        .filter(Boolean);
    if (variants.length > 0) member.nameVariants = variants;
    // 音声サンプル
    if (row.voice_sample_base64) {
        member.voiceSample = {
            blobBase64: row.voice_sample_base64,
            duration: row.voice_sample_duration || 0,
            recordedAt: row.voice_sample_recorded_at || row.updated_at,
        };
    }
    return member;
}

/** GET /api/members - 全メンバー取得（重複排除付き） */
export async function GET() {
    try {
        if (!knowledgeDb) return NextResponse.json({ members: [] });

        const { tenant, error } = await resolveTenantPlan();
        if (error || !tenant || tenant.expired) return NextResponse.json({ members: [] });

        const { data, error: dbError } = await knowledgeDb
            .from("members")
            .select("*, member_name_variants(name)")
            .eq("tenant_id", tenant.tenantId)
            .eq("is_active", true)
            .order("name");

        if (dbError) {
            console.error("GET /api/members error:", dbError);
            return NextResponse.json({ members: [] });
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

        // Step 2: name + company ベース（商談時の同姓同名でも別人として保持）
        const seenByName = new Map<string, any>();
        const deduped: any[] = [];
        for (const row of afterExtIdDedup) {
            const companyKey = ((row.company_name || row.company || "") as string).trim().toLowerCase();
            const nameKey = `${row.name.trim().toLowerCase()}::${companyKey}`;
            const existing = seenByName.get(nameKey);
            if (existing) {
                const scoreRow = (r: any) =>
                    (r.company_name ? 1 : 0) +
                    (r.voice_sample_base64 ? 1 : 0) +
                    (r.email ? 1 : 0) +
                    (r.department ? 1 : 0) +
                    (r.role ? 1 : 0);
                const keepNew = scoreRow(row) > scoreRow(existing) ||
                    (scoreRow(row) === scoreRow(existing) && row.updated_at > existing.updated_at);
                if (keepNew) {
                    duplicateIds.push(existing.id);
                    deduped[deduped.indexOf(existing)] = row;
                    seenByName.set(nameKey, row);
                } else {
                    duplicateIds.push(row.id);
                }
            } else {
                seenByName.set(nameKey, row);
                deduped.push(row);
            }
        }

        // 重複行を非同期でクリーンアップ
        if (duplicateIds.length > 0) {
            (async () => {
                try {
                    await knowledgeDb
                        .from("members")
                        .update({ is_active: false, updated_at: new Date().toISOString() })
                        .in("id", duplicateIds);
                    console.log(`Cleaned up ${duplicateIds.length} duplicate member row(s)`);
                } catch (err) {
                    console.error("Failed to cleanup duplicate members:", err);
                }
            })();
        }

        // name_variants を取得（JOIN結果がない場合のフォールバック）
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

/** POST /api/members - 単一メンバー作成（同名メンバーが存在する場合は既存を返却） */
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

        // 同名 + 同一会社の既存メンバーを検索（重複防止）。
        // 会社名が異なる場合は別人として新規作成する（商談時の同姓同名対策）。
        const bodyCompany = (body.company ?? "").trim() || null;
        const { data: sameName } = await knowledgeDb
            .from("members")
            .select("*")
            .eq("tenant_id", tenant.tenantId)
            .eq("is_active", true)
            .eq("name", name);

        // 両方 null（未設定）なら社内同姓同名と見なしてマージ。
        // どちらかに会社名がある場合は完全一致のみマージ。
        const existing = (sameName || []).filter((row) => {
            const rowCompany = ((row.company_name ?? row.company ?? "") as string) || null;
            return (rowCompany || null) === bodyCompany;
        });

        let memberRow: any;

        if (existing.length > 0) {
            // 既存メンバーが見つかった → 属性/音声を更新して返却
            memberRow = existing[0];
            const updates: any = { updated_at: new Date().toISOString() };
            if (body.voiceSample) {
                updates.voice_sample_base64 = body.voiceSample.blobBase64;
                updates.voice_sample_duration = body.voiceSample.duration;
                updates.voice_sample_recorded_at = body.voiceSample.recordedAt;
            }
            // プロファイルフィールドも更新
            if (body.email !== undefined) updates.email = body.email || null;
            if (body.company !== undefined) updates.company_name = body.company || null;
            if (body.department !== undefined) updates.department = body.department || null;
            if (body.role !== undefined) updates.role = body.role || null;
            if (body.type !== undefined) updates.type = body.type || "internal";

            await knowledgeDb
                .from("members")
                .update(updates)
                .eq("id", memberRow.id);

            // 更新後を再取得
            const { data: updated } = await knowledgeDb
                .from("members").select("*").eq("id", memberRow.id).single();
            memberRow = updated || memberRow;
        } else {
            // 新規メンバー作成
            const now = new Date().toISOString();
            const row: any = {
                tenant_id: tenant.tenantId,
                name,
                email: body.email || null,
                type: body.type || "internal",
                company_name: body.company || null,
                department: body.department || null,
                role: body.role || null,
                is_active: true,
                created_at: now,
                updated_at: now,
            };

            if (body.voiceSample) {
                row.voice_sample_base64 = body.voiceSample.blobBase64;
                row.voice_sample_duration = body.voiceSample.duration;
                row.voice_sample_recorded_at = body.voiceSample.recordedAt;
            }

            const { data: inserted, error: insertError } = await knowledgeDb
                .from("members")
                .insert(row)
                .select("*")
                .single();

            if (insertError) {
                console.error("POST /api/members insert error:", insertError);
                return NextResponse.json({ error: "メンバーの作成に失敗しました" }, { status: 500 });
            }

            memberRow = inserted;
        }

        // nameVariants を member_name_variants テーブルに同期
        if (memberRow && body.nameVariants && Array.isArray(body.nameVariants)) {
            await knowledgeDb
                .from("member_name_variants")
                .delete()
                .eq("member_id", memberRow.id);

            const variantRows = body.nameVariants
                .filter(Boolean)
                .map((n: string) => ({ member_id: memberRow.id, name: n }));
            if (variantRows.length > 0) {
                await knowledgeDb
                    .from("member_name_variants")
                    .insert(variantRows);
            }
        }

        // name_variants
        const { data: variants } = await knowledgeDb
            .from("member_name_variants")
            .select("name")
            .eq("member_id", memberRow.id);

        return NextResponse.json({
            member: toMemberData(memberRow, new Map([[memberRow.id, (variants || []).map((v: any) => v.name)]])),
        });
    } catch (error: any) {
        console.error("POST /api/members error:", error);
        return NextResponse.json(
            { error: error.message || "メンバーの作成に失敗しました" },
            { status: 500 },
        );
    }
}
