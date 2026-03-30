import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveTenantPlan } from "@/lib/plan";
import { getTenantConfig, knowledgeDb } from "@/lib/supabase";

/**
 * tenant_configs → knowledge スキーマへデータ移行
 * 旧フォーマット（JSON）を正規化テーブルに投入
 *
 * POST /api/admin/migrate-knowledge
 * - dryRun=true でプレビュー（デフォルト）
 * - dryRun=false で実行
 */
export async function POST(request: Request) {
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

        const body = await request.json().catch(() => ({}));
        const dryRun = body.dryRun !== false;

        const result: any = {
            dryRun,
            tenantId: tenant.tenantId,
            members: { found: 0, migrated: 0 },
            presets: { found: 0, migrated: 0 },
            terminology: { found: 0, migrated: 0 },
        };

        // ─── メンバー移行 ───
        const membersConfig = await getTenantConfig(tenant.tenantId, "members");
        const oldMembers = membersConfig?.data?.members || [];
        result.members.found = oldMembers.length;

        if (oldMembers.length > 0 && !dryRun) {
            // 既存メンバーの external_id を取得して重複チェック
            const { data: existing } = await knowledgeDb
                .from("members")
                .select("id, external_id")
                .eq("tenant_id", tenant.tenantId);
            const existingExtIds = new Set(
                (existing || []).map((m: any) => m.external_id).filter(Boolean)
            );

            for (const member of oldMembers) {
                if (existingExtIds.has(member.id)) continue; // 既に移行済み

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
                    created_at: member.createdAt || new Date().toISOString(),
                    updated_at: member.updatedAt || new Date().toISOString(),
                };

                if (member.voiceSample) {
                    row.voice_sample_base64 = member.voiceSample.blobBase64;
                    row.voice_sample_duration = member.voiceSample.duration;
                    row.voice_sample_recorded_at = member.voiceSample.recordedAt;
                }

                const { data: inserted } = await knowledgeDb
                    .from("members")
                    .insert(row)
                    .select("id")
                    .single();

                // name_variants
                if (inserted && member.nameVariants?.length > 0) {
                    await knowledgeDb
                        .from("member_name_variants")
                        .insert(
                            member.nameVariants.map((name: string) => ({
                                member_id: inserted.id,
                                name,
                            }))
                        );
                }

                result.members.migrated++;
            }
        }

        // ─── プリセット移行 ───
        const presetsConfig = await getTenantConfig(tenant.tenantId, "presets");
        const oldPresets = presetsConfig?.data?.presets || [];
        result.presets.found = oldPresets.length;

        if (oldPresets.length > 0 && !dryRun) {
            // 既存プリセットの external_id を取得して重複チェック
            const { data: existingPresets } = await knowledgeDb
                .from("meeting_presets")
                .select("id, external_id")
                .eq("tenant_id", tenant.tenantId);
            const existingPresetExtIds = new Set(
                (existingPresets || []).map((p: any) => p.external_id).filter(Boolean)
            );

            // external_id → UUID マッピング（メンバー）
            const { data: members } = await knowledgeDb
                .from("members")
                .select("id, external_id")
                .eq("tenant_id", tenant.tenantId);
            const memberUuidMap = new Map(
                (members || [])
                    .filter((m: any) => m.external_id)
                    .map((m: any) => [m.external_id, m.id])
            );

            for (const preset of oldPresets) {
                if (existingPresetExtIds.has(preset.id)) continue;

                const row: any = {
                    tenant_id: tenant.tenantId,
                    name: preset.name,
                    external_id: preset.id,
                    mode: preset.mode || "internal",
                    duration_min: preset.duration || null,
                    additional_prompt: preset.additionalPrompt || null,
                    is_archived: preset.isArchived || false,
                    last_used_at: preset.lastUsedAt || null,
                    usage_count: preset.usageCount || 0,
                    created_at: preset.createdAt || new Date().toISOString(),
                    updated_at: preset.updatedAt || new Date().toISOString(),
                };

                const { data: inserted } = await knowledgeDb
                    .from("meeting_presets")
                    .insert(row)
                    .select("id")
                    .single();

                // preset_members
                if (inserted && preset.memberIds?.length > 0) {
                    const memberRows = preset.memberIds
                        .map((extId: string) => {
                            const uuid = memberUuidMap.get(extId);
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
                        await knowledgeDb
                            .from("preset_members")
                            .insert(memberRows);
                    }
                }

                result.presets.migrated++;
            }
        }

        // ─── 用語移行 ───
        const promptsConfig = await getTenantConfig(tenant.tenantId, "prompts");
        const terminologyText = promptsConfig?.data?.terminology || "";

        if (terminologyText) {
            // パース
            const terms: { term: string; reading: string; description: string; category: string }[] = [];
            let currentCategory = "general";
            for (const line of terminologyText.split("\n")) {
                const trimmed = line.trim();
                if (/^##\s/.test(trimmed)) {
                    if (/社名|ブランド/i.test(trimmed)) currentCategory = "brand";
                    else if (/略語|社内/i.test(trimmed)) currentCategory = "abbreviation";
                    else if (/専門/i.test(trimmed)) currentCategory = "technical";
                    continue;
                }
                const cleaned = trimmed.replace(/^[-・]\s*/, "").trim();
                if (!cleaned) continue;

                // パース: "用語（読み）— 説明"
                const newFmt = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])\s*[—\-]\s*(.+)$/);
                if (newFmt) {
                    terms.push({ term: newFmt[1].trim(), reading: newFmt[2].trim(), description: newFmt[3].trim(), category: currentCategory });
                    continue;
                }
                const readingFmt = cleaned.match(/^(.+?)(?:[（(])(.+?)(?:[）)])$/);
                if (readingFmt) {
                    terms.push({ term: readingFmt[1].trim(), reading: readingFmt[2].trim(), description: "", category: currentCategory });
                    continue;
                }
                const eqFmt = cleaned.match(/^(.+?)\s*=\s*(.+)$/);
                if (eqFmt) {
                    terms.push({ term: eqFmt[1].trim(), reading: "", description: eqFmt[2].trim(), category: currentCategory });
                    continue;
                }
                terms.push({ term: cleaned, reading: "", description: "", category: currentCategory });
            }

            result.terminology.found = terms.length;

            if (terms.length > 0 && !dryRun) {
                // 既存用語チェック
                const { data: existingTerms } = await knowledgeDb
                    .from("terminology")
                    .select("term")
                    .eq("tenant_id", tenant.tenantId);
                const existingTermSet = new Set(
                    (existingTerms || []).map((t: any) => t.term)
                );

                for (const t of terms) {
                    if (existingTermSet.has(t.term)) continue;

                    await knowledgeDb
                        .from("terminology")
                        .insert({
                            tenant_id: tenant.tenantId,
                            term: t.term,
                            reading: t.reading || null,
                            definition: t.description || null,
                            category: t.category,
                            source: "imported",
                        });
                    result.terminology.migrated++;
                }
            }
        }

        return NextResponse.json(result);
    } catch (error: any) {
        console.error("POST /api/admin/migrate-knowledge error:", error);
        return NextResponse.json(
            { error: error.message || "移行に失敗しました" },
            { status: 500 }
        );
    }
}
