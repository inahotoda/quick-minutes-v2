import { NextRequest, NextResponse } from "next/server";
import { generateEverythingStream, GEMINI_MODEL, fileManager, waitForFileActive } from "@/lib/gemini";
import { MeetingMode } from "@/types";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

import { findFileByName, getFileContent } from "@/lib/drive";

const PROMPTS_FILENAME = "prompts-config.json";
const LOCAL_PROMPTS_FILE = path.join(process.cwd(), "prompts-config.json");
const CONFIG_FOLDER_ID = "1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY";

async function loadCustomPrompts() {
    try {
        // 1. Google Driveから検索
        const file = await findFileByName(PROMPTS_FILENAME, CONFIG_FOLDER_ID);
        if (file && file.id) {
            const content = await getFileContent(file.id) as any;
            return typeof content === "string" ? JSON.parse(content) : content;
        }

        // 2. なければローカル（初期値）から読み込み
        const data = await fs.readFile(LOCAL_PROMPTS_FILE, "utf-8");
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

    try {
        const body = await request.json();
        const { mode, transcript, audioData, uploadedFiles, date } = body;
        console.log("🚀 [API] Start processing generation request", {
            mode,
            hasAudio: !!audioData,
            filesCount: uploadedFiles?.length
        });

        console.log("🚀 [API] Loading custom prompts...");
        const customPrompts = await loadCustomPrompts();
        console.log("🚀 [API] Custom prompts loaded");

        const geminiFiles: string[] = [];
        if (audioData?.fileId) geminiFiles.push(audioData.fileId);
        if (uploadedFiles) uploadedFiles.forEach((f: any) => { if (f.fileId) geminiFiles.push(f.fileId); });

        if (geminiFiles.length > 0) {
            console.log("🚀 [API] Phase 1: Waiting for Gemini files to be ACTIVE...");
            await waitForFileActive(geminiFiles);
            console.log("🚀 [API] Phase 1: Complete");
        }

        const stream = new ReadableStream({
            async start(controller) {
                console.log("🚀 [API] Phase 2: Starting generation stream...");
                try {
                    const genStream = generateEverythingStream({
                        mode: mode as MeetingMode,
                        transcript,
                        audioData: audioData,
                        uploadedFiles: uploadedFiles,
                        date,
                        customPrompts,
                    });

                    let chunkCount = 0;
                    for await (const chunk of genStream) {
                        if (chunkCount === 0) {
                            console.log("🚀 [API] SUCCESS: Received FIRST chunk from Gemini!");
                        }
                        chunkCount++;
                        controller.enqueue(encoder.encode(chunk));
                    }
                    console.log(`🚀 [API] Generation finished. Total chunks: ${chunkCount}`);
                    controller.close();
                } catch (error) {
                    console.error("❌ [API] Stream generation error:", error);
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
        console.error("POST /api/generate: Generate error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "生成エラー" }, { status: 500 });
    }
}
