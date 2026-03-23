import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findFileByName, getFileContent } from "@/lib/drive";
import { saveTenantConfig } from "@/lib/supabase";

const CONFIG_FOLDER_ID = "1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY";
const ADMIN_EMAIL = process.env.ADMIN_USER_EMAIL || "";

/**
 * GET /api/admin/migrate-config
 * Google DriveのINAHO設定をSupabase tenant_configsに移行（1回限り）
 */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (session?.user?.email !== ADMIN_EMAIL) {
            return NextResponse.json({ error: "管理者のみ" }, { status: 403 });
        }

        const results: Record<string, string> = {};

        // prompts-config.json
        const promptsFile = await findFileByName("prompts-config.json", CONFIG_FOLDER_ID);
        if (promptsFile?.id) {
            const content = await getFileContent(promptsFile.id);
            if (content) {
                const data = typeof content === "string" ? JSON.parse(content) : content;
                await saveTenantConfig("inaho", "prompts", data, "migration");
                results.prompts = "migrated";
            }
        } else {
            results.prompts = "not found in Drive";
        }

        // members-config.json
        const membersFile = await findFileByName("members-config.json", CONFIG_FOLDER_ID);
        if (membersFile?.id) {
            const content = await getFileContent(membersFile.id);
            if (content) {
                const data = typeof content === "string" ? JSON.parse(content) : content;
                await saveTenantConfig("inaho", "members", data, "migration");
                results.members = "migrated";
            }
        } else {
            results.members = "not found in Drive";
        }

        // presets-config.json
        const presetsFile = await findFileByName("presets-config.json", CONFIG_FOLDER_ID);
        if (presetsFile?.id) {
            const content = await getFileContent(presetsFile.id);
            if (content) {
                const data = typeof content === "string" ? JSON.parse(content) : content;
                await saveTenantConfig("inaho", "presets", data, "migration");
                results.presets = "migrated";
            }
        } else {
            results.presets = "not found in Drive";
        }

        return NextResponse.json({ success: true, results });
    } catch (error: any) {
        console.error("Migration error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
