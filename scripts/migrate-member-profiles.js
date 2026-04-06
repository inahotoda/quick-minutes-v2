/**
 * メンバープロファイル移行スクリプト
 * tenant_configs (config_type: "members") のJSONに含まれるプロファイルデータを
 * knowledge.members テーブル + member_name_variants テーブルに転記する
 *
 * 対象フィールド: company, department, role, type (member_type), email, nameVariants
 *
 * 使い方: node scripts/migrate-member-profiles.js
 */
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
    "https://dmtkkwhwjzigbslcmzcu.supabase.co",
    "sb_publishable_HK9RRUZVwGLLpWZag3kN_w_AabeEj4k"
);

const knowledgeDb = createClient(
    "https://dmtkkwhwjzigbslcmzcu.supabase.co",
    "sb_publishable_HK9RRUZVwGLLpWZag3kN_w_AabeEj4k",
    { db: { schema: "knowledge" } }
);

async function main() {
    // 1. 全テナントの members config を取得
    const { data: configs, error: configErr } = await supabase
        .from("tenant_configs")
        .select("tenant_id, data")
        .eq("config_type", "members");

    if (configErr) {
        console.error("❌ tenant_configs 取得エラー:", configErr);
        return;
    }

    if (!configs || configs.length === 0) {
        console.log("ℹ️  tenant_configs に members データなし");
        return;
    }

    let totalUpdated = 0;
    let totalVariants = 0;

    for (const config of configs) {
        const tenantId = config.tenant_id;
        const members = config.data?.members || [];
        console.log(`\n📋 テナント: ${tenantId} — ${members.length} メンバー`);

        // 2. knowledge.members の既存データを取得
        const { data: knowledgeMembers } = await knowledgeDb
            .from("members")
            .select("id, external_id, name")
            .eq("tenant_id", tenantId);

        const byExtId = new Map(
            (knowledgeMembers || [])
                .filter(m => m.external_id)
                .map(m => [m.external_id, m])
        );

        for (const member of members) {
            const existing = byExtId.get(member.id);
            if (!existing) {
                // knowledge.members に存在しないメンバーはスキップ
                // （POST /api/members で同期されていないか、削除済み）
                continue;
            }

            const hasProfile = member.company || member.department || member.role ||
                member.type || member.email || (member.nameVariants && member.nameVariants.length > 0);
            if (!hasProfile) continue;

            // 3. プロファイルフィールドを更新
            const updates = {};
            if (member.company) updates.company = member.company;
            if (member.department) updates.department = member.department;
            if (member.role) updates.role = member.role;
            if (member.type) updates.member_type = member.type;
            if (member.email) updates.email = member.email;

            if (Object.keys(updates).length > 0) {
                updates.updated_at = new Date().toISOString();
                const { error: updateErr } = await knowledgeDb
                    .from("members")
                    .update(updates)
                    .eq("id", existing.id);

                if (updateErr) {
                    console.error(`  ❌ ${member.name} 更新エラー:`, updateErr.message);
                    continue;
                }
                totalUpdated++;
                console.log(`  ✏️  ${member.name}: ${Object.keys(updates).filter(k => k !== "updated_at").join(", ")}`);
            }

            // 4. nameVariants を member_name_variants に同期
            if (member.nameVariants && member.nameVariants.length > 0) {
                // 既存を削除
                await knowledgeDb
                    .from("member_name_variants")
                    .delete()
                    .eq("member_id", existing.id);

                // 新規挿入
                const rows = member.nameVariants
                    .filter(Boolean)
                    .map(name => ({ member_id: existing.id, name }));

                if (rows.length > 0) {
                    const { error: variantErr } = await knowledgeDb
                        .from("member_name_variants")
                        .insert(rows);

                    if (variantErr) {
                        console.error(`  ❌ ${member.name} nameVariants エラー:`, variantErr.message);
                    } else {
                        totalVariants += rows.length;
                        console.log(`  📝 ${member.name}: nameVariants = [${member.nameVariants.join(", ")}]`);
                    }
                }
            }
        }
    }

    console.log(`\n✅ 完了！ 更新: ${totalUpdated}件, nameVariants: ${totalVariants}件`);
}

main().catch(console.error);
