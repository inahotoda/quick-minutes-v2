import { NextRequest, NextResponse } from "next/server";
import { generateEverythingStream, GEMINI_MODEL, fileManager, waitForFileActive, SpeakerInfo } from "@/lib/gemini";
import { transcribeWithSpeakerDiarization, TranscriptionResult } from "@/lib/speech-to-text";
import { MeetingMode } from "@/types";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

import { resolveTenantPlan } from "@/lib/plan";
import { getTenantConfig } from "@/lib/supabase";
import { loadTerminologyText } from "@/lib/knowledge-terminology";
import { logUsage } from "@/lib/usage-logger";

// Vercel Pro: max 300s. Speech-to-Text + Gemini streaming needs sufficient time.
export const maxDuration = 300;

async function loadCustomPrompts() {
    try {
        const { tenant } = await resolveTenantPlan();
        if (tenant?.tenantId) {
            const config = await getTenantConfig(tenant.tenantId, "prompts");
            const promptData = config?.data || {};
            // terminology は knowledge スキーマから取得
            const terminology = await loadTerminologyText(tenant.tenantId);
            return { ...promptData, terminology };
        }
        return {};
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
    const requestStartTime = Date.now();

    try {
        const body = await request.json();
        const { mode, transcript, audioData, uploadedFiles, date, useSpeakerDiarization = true, participants = [], feedback, notes, memberProfiles } = body;
        console.log("🚀 [API] Start processing generation request", {
            mode,
            hasAudio: !!audioData,
            filesCount: uploadedFiles?.length,
            useSpeakerDiarization,
            participantsCount: participants?.length,
            participants: participants
        });

        // テナント情報を取得（コスト計測用）
        const { tenant } = await resolveTenantPlan();

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

        // Phase 1.5: Speech-to-Textで話者分離付き文字起こし（音声データがある場合）
        let speakerInfo: SpeakerInfo | undefined;

        if (audioData?.base64 && useSpeakerDiarization) {
            console.log("🚀 [API] Phase 1.5: Starting Speech-to-Text with speaker diarization...");
            const sttStartTime = Date.now();
            try {
                const audioBuffer = Buffer.from(audioData.base64, "base64");
                const transcriptionResult = await transcribeWithSpeakerDiarization(audioBuffer);

                if (transcriptionResult.formattedTranscript) {
                    speakerInfo = {
                        speakerMapping: transcriptionResult.speakerMapping,
                        formattedTranscript: transcriptionResult.formattedTranscript,
                    };
                    console.log(`🚀 [API] Phase 1.5: Complete. Identified ${Object.keys(transcriptionResult.speakerMapping).length} speakers`);
                    console.log(`🚀 [API] Speakers: ${JSON.stringify(transcriptionResult.speakerMapping)}`);
                }

                // STTコスト計測
                if (tenant) {
                    logUsage({
                        tenantDomain: tenant.domain,
                        userEmail: tenant.userEmail,
                        eventType: "stt",
                        durationMs: Date.now() - sttStartTime,
                        metadata: { speakerCount: Object.keys(transcriptionResult.speakerMapping).length },
                    });
                }
            } catch (error) {
                console.error("⚠️ [API] Speech-to-Text failed, falling back to Gemini-only:", error);
                // Speech-to-Textが失敗しても、Geminiで処理を続行
            }
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
                        speakerInfo,
                        participants,
                        feedback,
                        notes,
                        memberProfiles,
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

                    // 議事録生成コスト計測
                    if (tenant) {
                        logUsage({
                            tenantDomain: tenant.domain,
                            userEmail: tenant.userEmail,
                            eventType: feedback ? "regenerate" : "generate",
                            durationMs: Date.now() - requestStartTime,
                            model: GEMINI_MODEL,
                            metadata: {
                                mode,
                                hasAudio: !!audioData,
                                filesCount: uploadedFiles?.length ?? 0,
                                chunkCount,
                                participantsCount: participants?.length ?? 0,
                            },
                        });
                    }

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
        const isFileProcessingFailed = (error as any)?.code === "FILE_PROCESSING_FAILED";
        return NextResponse.json(
            {
                error: error instanceof Error ? error.message : "生成エラー",
                code: isFileProcessingFailed ? "FILE_PROCESSING_FAILED" : undefined,
            },
            { status: isFileProcessingFailed ? 503 : 500 }
        );
    }
}
