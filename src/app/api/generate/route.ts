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

    try {
        const body = await request.json();
        const { mode, transcript, audioData, uploadedFiles, date } = body;

        const customPrompts = await loadCustomPrompts();

        // Geminiにあるファイルの識別子を収集
        const geminiFiles: string[] = [];

        if (audioData?.fileId) {
            geminiFiles.push(audioData.fileId);
        }

        if (uploadedFiles && uploadedFiles.length > 0) {
            for (const file of uploadedFiles) {
                if (file.fileId) {
                    geminiFiles.push(file.fileId);
                }
            }
        }

        // 1. Wait for all files to be active
        if (geminiFiles.length > 0) {
            await waitForFileActive(geminiFiles);
        }

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    const genStream = generateEverythingStream({
                        mode: mode as MeetingMode,
                        transcript,
                        audioData: audioData,
                        uploadedFiles: uploadedFiles,
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
        return NextResponse.json({ error: "生成エラー" }, { status: 500 });
    }
}
