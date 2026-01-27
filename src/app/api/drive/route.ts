import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { findFolderByName, createFolder, uploadMarkdownAsDoc, uploadFile } from "@/lib/drive";

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const body = await request.json();
        const { topic, minutes, mode, audioBlob, audioMimeType } = body;

        if (!minutes) {
            return NextResponse.json(
                { error: "議事録の内容が必要です" },
                { status: 400 }
            );
        }

        // JSTでの日付取得
        const now = new Date();
        const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const yyyymmdd = jstNow.toISOString().split("T")[0].replace(/-/g, "");
        const dateFolderName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // 1. 保存先のベースフォルダIDを取得
        const rootFolderId = process.env.SHARED_DRIVE_ROOT_FOLDER_ID;
        const audioRootFolderId = process.env.SHARED_DRIVE_AUDIO_FOLDER_ID;

        // 2. 議事録用の日付フォルダを探す/作る
        let targetFolderId: string | undefined = rootFolderId;
        if (rootFolderId) {
            const existingDateFolder = await findFolderByName(dateFolderName, rootFolderId);
            if (existingDateFolder && existingDateFolder.id) {
                targetFolderId = existingDateFolder.id;
            } else {
                const newFolder = await createFolder(dateFolderName, rootFolderId);
                targetFolderId = newFolder.id || undefined;
            }
        }

        // 3. ファイル名を生成: yyyymmdd_モード_議題(作成者)
        const modeLabel = mode === "business" ? "商談" : mode === "internal" ? "社内" : "その他";
        const userName = session.user.name || "不明";
        const baseFileName = `${yyyymmdd}_${modeLabel}_${topic || "会議"}(${userName})`;

        // 4. 議事録を保存
        const doc = await uploadMarkdownAsDoc(
            `${baseFileName}_議事録`,
            minutes,
            targetFolderId
        );

        // 5. 音声データがある場合は保存（音声用ルートフォルダの直下に保存）
        let audioUrl = null;
        if (audioBlob) {
            const audioFile = await uploadFile(
                `${baseFileName}_音声`,
                audioBlob,
                audioMimeType || "audio/webm",
                audioRootFolderId || targetFolderId // 音声用フォルダがあればその直下、なければ議事録と同じ場所
            );
            audioUrl = audioFile.webViewLink;
        }

        return NextResponse.json({
            success: true,
            fileName: baseFileName,
            folderName: dateFolderName,
            docUrl: doc.webViewLink,
            audioUrl: audioUrl,
        });
    } catch (error) {
        console.error("Drive API error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "保存に失敗しました" },
            { status: 500 }
        );
    }
}
