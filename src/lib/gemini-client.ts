"use client";

/**
 * Gemini File API にブラウザから直接アップロードするためのユーティリティ
 */


const UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
const GET_FILE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiFileResponse {
    file: {
        name: string;
        displayName: string;
        mimeType: string;
        sizeBytes: string;
        createTime: string;
        updateTime: string;
        expirationTime: string;
        sha256Hash: string;
        uri: string;
        state: "PROCESSING" | "ACTIVE" | "FAILED";
        error?: { code: number; message: string; details?: unknown[] };
    };
}

/**
 * ブラウザから直接 Gemini File API にアップロードする
 */
export async function uploadToGemini(file: File | Blob, displayName: string): Promise<GeminiFileResponse> {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("NEXT_PUBLIC_GEMINI_API_KEY が設定されていません。");
    }

    const mimeType = file.type || "application/octet-stream";
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(1);
    console.log(`📤 [Upload] Starting: "${displayName}" (${mimeType}, ${fileSizeMB}MB)`);

    // Metadata
    const metadata = JSON.stringify({
        file: {
            displayName: displayName,
        },
    });

    // Construct multipart/related request body
    const boundary = "boundary_abc123";
    const header = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\n`;
    const footer = `\r\n--${boundary}--`;

    const fileBuffer = await file.arrayBuffer();
    const body = new Blob([
        header,
        `Content-Type: ${mimeType}\r\n\r\n`,
        fileBuffer,
        footer
    ]);

    const response = await fetch(`${UPLOAD_URL}?key=${apiKey}`, {
        method: "POST",
        headers: {
            "X-Goog-Upload-Protocol": "multipart",
            "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: body,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini Upload Error:", errorText);
        throw new Error(`Geminiへのアップロードに失敗しました: ${response.statusText}`);
    }

    const result: GeminiFileResponse = await response.json();
    console.log(`📤 [Upload] Done: "${displayName}" → ${result.file.name} (state: ${result.file.state})`);

    // アップロード直後にFAILEDの場合は即座にエラー
    if (result.file.state === "FAILED") {
        const errorDetail = result.file.error?.message || "不明なエラー";
        console.error(`❌ [Upload] File immediately FAILED: ${result.file.name}, error: ${errorDetail}`);
        throw new Error(
            `ファイル "${displayName}" のアップロードに失敗しました（${mimeType}, ${fileSizeMB}MB）: ${errorDetail}`
        );
    }

    return result;
}

/**
 * クライアント側からファイルの処理状態をポーリングし、ACTIVEになるまで待機する
 * サーバー側の waitForFileActive と同じAPIキーを使うことで、キー不一致問題を回避
 */
export async function waitForFileActiveClient(
    fileNames: string[],
    onProgress?: (status: string) => void
): Promise<void> {
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) throw new Error("NEXT_PUBLIC_GEMINI_API_KEY が設定されていません。");

    const MAX_WAIT = 120_000; // 2分
    const POLL_INTERVAL = 3_000; // 3秒

    const checkFile = async (name: string): Promise<void> => {
        const startTime = Date.now();

        while (true) {
            const res = await fetch(`${GET_FILE_URL}/${name}?key=${apiKey}`);
            if (!res.ok) {
                const errText = await res.text();
                console.error(`❌ [FileCheck] Failed to get file status: ${name}`, errText);
                throw new Error(`ファイル状態の確認に失敗しました: ${name}`);
            }
            const data = await res.json();
            const state = data.state;

            if (state === "ACTIVE") {
                console.log(`✅ [FileCheck] File is ACTIVE: ${name}`);
                return;
            }

            if (state === "FAILED") {
                const errorDetail = data.error?.message || "Geminiでのファイル処理に失敗しました";
                console.error(`❌ [FileCheck] File FAILED: ${name}, error:`, data.error);
                throw new Error(
                    `ファイル "${data.displayName || name}" の処理に失敗しました: ${errorDetail}`
                );
            }

            if (Date.now() - startTime > MAX_WAIT) {
                console.warn(`⚠️ [FileCheck] Timeout waiting for file: ${name}`);
                throw new Error(
                    `ファイル "${data.displayName || name}" の処理がタイムアウトしました（2分経過）`
                );
            }

            onProgress?.(`ファイル処理中... (${Math.round((Date.now() - startTime) / 1000)}秒)`);
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
    };

    await Promise.all(fileNames.map(name => checkFile(name)));
}
