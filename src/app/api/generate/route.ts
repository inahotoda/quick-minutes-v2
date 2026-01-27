import { NextRequest, NextResponse } from "next/server";
import { generateEverythingStream, GEMINI_MODEL, fileManager, waitForFileActive } from "@/lib/gemini";
import { MeetingMode } from "@/types";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const PROMPTS_FILE = path.join(process.cwd(), "prompts-config.json");
export const dynamic = "force-dynamic";

async function loadCustomPrompts() {
    try {
        const data = await fs.readFile(PROMPTS_FILE, "utf-8");
        return JSON.parse(data);
    } catch {
        return {};
    }
}

async function saveBase64ToTmp(base64: string, filename: string): Promise<string> {
    const buffer = Buffer.from(base64, "base64");
    const tmpPath = path.join(os.tmpdir(), `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`);
    await fs.writeFile(tmpPath, buffer);
    return tmpPath;
}

export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();
    const tempFiles: string[] = [];

    try {
        const body = await request.json();
        const { mode, transcript, audioBase64, audioMimeType, uploadedFiles, date } = body;

        const customPrompts = await loadCustomPrompts();

        // 1. Prepare files for Gemini File API
        const geminiFiles: string[] = [];
        let audioFileData = undefined;
        let processedUploadedFiles = undefined;

        // Handle Audio
        if (audioBase64) {
            const ext = audioMimeType.split("/")[1] || "webm";
            const tmpPath = await saveBase64ToTmp(audioBase64, `audio.${ext}`);
            tempFiles.push(tmpPath);

            try {
                const uploadResult = await fileManager.uploadFile(tmpPath, {
                    mimeType: audioMimeType,
                    displayName: "Meeting Audio",
                });
                geminiFiles.push(uploadResult.file.name);
                audioFileData = {
                    mimeType: audioMimeType,
                    fileUri: uploadResult.file.uri,
                };
            } finally {
                // Uploadが終わったらすぐにローカルのtmpを削除
                try {
                    await fs.unlink(tmpPath);
                    const idx = tempFiles.indexOf(tmpPath);
                    if (idx > -1) tempFiles.splice(idx, 1);
                } catch (e) { }
            }
        }

        // Handle Uploaded Files
        if (uploadedFiles && uploadedFiles.length > 0) {
            processedUploadedFiles = [];
            for (const file of uploadedFiles) {
                const tmpPath = await saveBase64ToTmp(file.base64, file.name);
                tempFiles.push(tmpPath);

                try {
                    const uploadResult = await fileManager.uploadFile(tmpPath, {
                        mimeType: file.mimeType,
                        displayName: file.name,
                    });
                    geminiFiles.push(uploadResult.file.name);
                    processedUploadedFiles.push({
                        name: file.name,
                        mimeType: file.mimeType,
                        fileUri: uploadResult.file.uri,
                    });
                } finally {
                    // Uploadが終わったらすぐにローカルのtmpを削除
                    try {
                        await fs.unlink(tmpPath);
                        const idx = tempFiles.indexOf(tmpPath);
                        if (idx > -1) tempFiles.splice(idx, 1);
                    } catch (e) { }
                }
            }
        }

        // 2. Wait for all files to be active
        if (geminiFiles.length > 0) {
            await waitForFileActive(geminiFiles);
        }

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    const genStream = generateEverythingStream({
                        mode: mode as MeetingMode,
                        transcript,
                        audioData: audioFileData,
                        uploadedFiles: processedUploadedFiles,
                        date,
                        customPrompts,
                    });

                    // 1パスで全てのデータを流し込む（Geminiが[MINUTES_START]から順に出力する）
                    for await (const chunk of genStream) {
                        controller.enqueue(encoder.encode(chunk));
                    }
                    controller.close();
                } catch (error) {
                    console.error("Stream error:", error);
                    controller.error(error);
                }
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-cache",
                "X-Model-Version": encodeURIComponent(GEMINI_MODEL),
            },
        });
    } catch (error) {
        console.error("Generate error:", error);
        // 残ったtmpファイルを削除
        for (const tmpPath of tempFiles) {
            try {
                await fs.unlink(tmpPath);
            } catch (e) { }
        }
        return NextResponse.json({ error: "生成エラー" }, { status: 500 });
    }
}
