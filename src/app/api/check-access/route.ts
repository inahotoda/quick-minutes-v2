import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { google } from "googleapis";

// アクセス権確認用の共有ドライブID
const CONFIG_FOLDER_ID = "0AEGO8vJJ35GMUk9PVA";
const FOLDER_NAME = "議事録アプリ設定フォルダ";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session?.accessToken) {
            return NextResponse.json({
                hasAccess: false,
                error: "認証が必要です",
                needsLogin: true
            });
        }

        // Google Drive APIクライアントを作成
        const auth = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );
        auth.setCredentials({ access_token: session.accessToken as string });
        const drive = google.drive({ version: "v3", auth });

        try {
            // 共有フォルダにアクセスできるか確認
            const response = await drive.files.get({
                fileId: CONFIG_FOLDER_ID,
                fields: "id, name, capabilities",
                supportsAllDrives: true,
            });

            if (response.data.id) {
                return NextResponse.json({
                    hasAccess: true,
                    folderName: response.data.name
                });
            }
        } catch (driveError: any) {
            console.error("Drive access check failed:", driveError.message);

            // 404 or 403 = アクセス権なし
            if (driveError.code === 404 || driveError.code === 403) {
                return NextResponse.json({
                    hasAccess: false,
                    error: "共有フォルダへのアクセス権がありません",
                    folderId: CONFIG_FOLDER_ID,
                    folderName: FOLDER_NAME,
                    requestAccessUrl: `https://drive.google.com/drive/folders/${CONFIG_FOLDER_ID}`
                });
            }

            throw driveError;
        }

        return NextResponse.json({
            hasAccess: false,
            error: "フォルダの確認に失敗しました"
        });
    } catch (error: any) {
        console.error("Access check error:", error);
        return NextResponse.json({
            hasAccess: false,
            error: error.message || "アクセス確認中にエラーが発生しました"
        });
    }
}
