import { NextRequest, NextResponse } from "next/server";
import { generateEverythingStream, GEMINI_MODEL } from "@/lib/gemini";
import { MeetingMode } from "@/types";
import { promises as fs } from "fs";
import path from "path";

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

export async function POST(request: NextRequest) {
    const encoder = new TextEncoder();

    try {
        const body = await request.json();
        const { mode, transcript, audioBase64, audioMimeType, uploadedFiles, date } = body;

        const customPrompts = await loadCustomPrompts();

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    const genStream = generateEverythingStream({
                        mode: mode as MeetingMode,
                        transcript,
                        audioData: audioBase64 ? { base64: audioBase64, mimeType: audioMimeType } : undefined,
                        uploadedFiles,
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
        return NextResponse.json({ error: "生成エラー" }, { status: 500 });
    }
}
