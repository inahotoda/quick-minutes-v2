"use client";

/**
 * Gemini File API にブラウザから直接アップロードするためのユーティリティ
 */


const UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";

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

    // Metadata
    const metadata = {
        file: {
            displayName: displayName,
        },
    };

    // Construct multipart/related request body
    const boundary = "-------" + Math.random().toString(36).substring(2);

    // Header part (Metadata)
    const header = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\n`;
    const footer = `\r\n--${boundary}--`;

    const fileBuffer = await file.arrayBuffer();
    const body = new Blob([
        header,
        `Content-Type: ${mimeType}\r\n\r\n`,
        fileBuffer,
        footer
    ], { type: `multipart/related; boundary=${boundary}` });

    const response = await fetch(`${UPLOAD_URL}?key=${apiKey}`, {
        method: "POST",
        headers: {
            "X-Goog-Upload-Protocol": "multipart",
        },
        body: body,
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Gemini Upload Error:", errorText);
        throw new Error(`Geminiへのアップロードに失敗しました: ${response.statusText}`);
    }

    return await response.json();
}
