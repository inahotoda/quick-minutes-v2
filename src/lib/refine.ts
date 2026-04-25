import Anthropic from "@anthropic-ai/sdk";
import { MeetingMode } from "@/types";
import { REFINE_SYSTEM_PROMPTS } from "./refine-prompts";

/**
 * Phase 2: Claude Opus 4.7 による議事録の推敲。
 *
 * Phase 1 (Gemini) が生成した下書きをモード別に推敲する。
 * - max_tokens を大きく取り、ストリーミングで返す（SDK のタイムアウト回避）
 * - 大きな共通プロンプトは prompt caching に乗せて 2 回目以降のコストを下げる
 * - adaptive thinking を有効化し、難しい推敲には自動で深く考える
 */

export const REFINE_MODEL = "Claude Opus 4.7";
const MODEL_NAME = "claude-opus-4-7";

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
    if (!_anthropic) {
        _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
    }
    return _anthropic;
}

interface RefineParams {
    mode: MeetingMode;
    /** Phase 1 が出力した議事録 Markdown（[MINUTES_START]/[MINUTES_END] を含めても含めなくてもよい） */
    draftMarkdown: string;
    /** 確定済みの参加者リスト */
    participants?: string[];
    /** 用語ルール（あれば） */
    terminology?: string;
    /** ユーザーが追加した背景メモ */
    notes?: string;
    /** 再推敲リクエスト時の修正指示 */
    feedback?: string;
    /** 会議日 */
    date?: string;
    /** ストリーム終了時に Anthropic 使用量統計を受け取るコールバック（コスト計測用） */
    onUsage?: (usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    }) => void;
}

function buildContextSection(p: RefineParams): string {
    const parts: string[] = [];
    if (p.date) parts.push(`# 会議日: ${p.date}`);
    if (p.participants && p.participants.length > 0) {
        parts.push(`# 確定参加者リスト\n${p.participants.map((n) => `- ${n}`).join("\n")}\n\n参加者欄および担当者欄は必ずこのリストの表記を使用してください。`);
    }
    if (p.terminology) {
        parts.push(`# 用語・表記ルール\n${p.terminology}\n\n固有名詞・専門用語は必ずこのルールに従ってください。`);
    }
    if (p.notes) {
        parts.push(`# ユーザーからの背景メモ\n${p.notes}`);
    }
    if (p.feedback) {
        parts.push(`# ユーザーからの修正指示（最優先で反映）\n"${p.feedback}"\n\nこの指示を最優先で反映した議事録に推敲してください。`);
    }
    return parts.join("\n\n");
}

/**
 * Phase 2 の推敲をストリーミングで実行する。
 * 各チャンクのテキストを yield する。
 */
export async function* refineStream(params: RefineParams): AsyncGenerator<string> {
    const anthropic = getAnthropic();
    const systemPrompt = REFINE_SYSTEM_PROMPTS[params.mode];
    const contextSection = buildContextSection(params);
    const cleanedDraft = params.draftMarkdown.trim();

    const userBlocks: Anthropic.Messages.ContentBlockParam[] = [];
    if (contextSection) {
        userBlocks.push({ type: "text", text: contextSection });
    }
    userBlocks.push({
        type: "text",
        text: `# Phase 1 議事録（推敲対象）\n以下は Gemini が生成した下書きです。これをモード固有の構造と粒度に整え、拾い漏れを補完し、最終的な議事録として出力してください。\n\n---\n${cleanedDraft}\n---\n\n出力は必ず [MINUTES_START] と [MINUTES_END] で囲んでください。`,
    });

    const stream = anthropic.messages.stream({
        model: MODEL_NAME,
        max_tokens: 32000,
        // モード共通プロンプト全体をキャッシュに乗せる（同テナント・同モードの 5 分以内の再生成で効く）
        system: [
            {
                type: "text",
                text: systemPrompt,
                cache_control: { type: "ephemeral" },
            },
        ],
        thinking: { type: "adaptive" },
        messages: [
            {
                role: "user",
                content: userBlocks,
            },
        ],
    });

    for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield event.delta.text;
        }
    }

    if (params.onUsage) {
        try {
            const finalMessage = await stream.finalMessage();
            params.onUsage({
                input_tokens: finalMessage.usage.input_tokens,
                output_tokens: finalMessage.usage.output_tokens,
                cache_creation_input_tokens: finalMessage.usage.cache_creation_input_tokens ?? undefined,
                cache_read_input_tokens: finalMessage.usage.cache_read_input_tokens ?? undefined,
            });
        } catch {
            // usage取得失敗は無視（ストリームは成功済み）
        }
    }
}
