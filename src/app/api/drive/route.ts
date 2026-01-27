import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findFolderByName, createFolder, uploadMarkdownAsDoc, uploadFile } from "@/lib/drive";

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const body = await request.json();
        const { topic, minutes, mode, audioBlob, audioMimeType, uploadedAudios } = body;

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
        // 議事録・日付フォルダ作成用: 1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY
        // 音声ファイル保存用: 1zfWmEmsrG7h0GNmz0sHILhBlw-L3NDKr
        const rootFolderId = process.env.SHARED_DRIVE_ROOT_FOLDER_ID || "1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY";
        const audioRootFolderId = process.env.SHARED_DRIVE_AUDIO_FOLDER_ID || "1zfWmEmsrG7h0GNmz0sHILhBlw-L3NDKr";

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
        const getExtension = (mimeType: string) => {
            if (mimeType.includes("webm")) return ".webm";
            if (mimeType.includes("mp4") || mimeType.includes("m4a")) return ".m4a";
            if (mimeType.includes("mpeg")) return ".mp3";
            if (mimeType.includes("wav")) return ".wav";
            return "";
        };

        if (audioBlob) {
            // 録音データはユーザーの強い要望により拡張子を .m4a、MIMEタイプを audio/mp4 に固定
            const audioFile = await uploadFile(
                `${baseFileName}_音声.m4a`,
                audioBlob,
                "audio/mp4",
                audioRootFolderId || targetFolderId
            );
            audioUrl = audioFile.webViewLink;
        }

        // 6. アップロードされた音声ファイルがある場合も保存
        if (uploadedAudios && Array.isArray(uploadedAudios)) {
            for (let i = 0; i < uploadedAudios.length; i++) {
                const audio = uploadedAudios[i];
                // 複数ファイルある場合は番号を付与するが、1つならそのまま
                const suffix = uploadedAudios.length > 1 ? `_${i + 1}` : "";
                const ext = getExtension(audio.mimeType);
                await uploadFile(
                    `${baseFileName}_音声${suffix}${ext}`,
                    audio.base64,
                    audio.mimeType,
                    audioRootFolderId || targetFolderId
                );
            }
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
