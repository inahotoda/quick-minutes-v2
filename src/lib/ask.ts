import Anthropic from "@anthropic-ai/sdk";

/**
 * 議事録に対する質問・追加分析。
 *
 * 「この議事録から〇〇を抽出して」「△△の論点をもう少し詳しく」「英訳して」など、
 * 議事録を文脈にした自由形式の問い合わせを受け付ける。
 *
 * - 議事録本文は prompt caching に乗せる（同セッション内で複数質問する場合のコスト削減）
 * - 出力はストリーミング
 * - adaptive thinking で複雑な質問には深く考える
 */

export const ASK_MODEL = "Claude Opus 4.7";
const MODEL_NAME = "claude-opus-4-7";

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
    if (!_anthropic) {
        _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "" });
    }
    return _anthropic;
}

interface AskParams {
    minutesMarkdown: string;
    question: string;
    /** 過去の質問・回答ペア（マルチターン用） */
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    /** ストリーム終了時に Anthropic 使用量統計を受け取るコールバック */
    onUsage?: (usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
    }) => void;
}

const SYSTEM_PROMPT = `あなたは議事録を読み込んで、ユーザーの質問に答えるアシスタントです。

# 守るべきこと
1. **議事録に書かれていない情報は決して捏造しない**。書かれていない場合は「議事録には記載がありません」と答える。
2. 回答は**簡潔に**。冗長な前置きは省く。
3. ユーザーの質問の意図を汲む（要約・抽出・翻訳・分析・確認など）。
4. 必要に応じて**箇条書き・表・引用**を使い分ける。
5. 引用する場合は議事録の該当箇所を「」で示す。

# 想定される質問タイプ
- 抽出: 「〇〇さんのアクションを全部教えて」「金額の言及だけ抜き出して」
- 要約: 「3行で要約して」「経営会議向けにまとめ直して」
- 分析: 「リスクは何？」「次回までに準備すべきは？」
- 翻訳: 「英訳して」「先方向けにメール文面にして」
- 確認: 「□□について何か言及あった？」`;

export async function* askStream(params: AskParams): AsyncGenerator<string> {
    const anthropic = getAnthropic();

    // 履歴 + 今回の質問
    const messages: Anthropic.Messages.MessageParam[] = [];

    // 議事録は最初のユーザーメッセージとしてキャッシュに乗せる
    messages.push({
        role: "user",
        content: [
            {
                type: "text",
                text: `# 議事録\n\n${params.minutesMarkdown.trim()}`,
                cache_control: { type: "ephemeral" },
            },
        ],
    });
    messages.push({
        role: "assistant",
        content: "了解しました。この議事録について質問やご要望をどうぞ。",
    });

    // 履歴を展開
    for (const entry of params.history || []) {
        messages.push({ role: entry.role, content: entry.content });
    }

    // 今回の質問
    messages.push({ role: "user", content: params.question });

    const stream = anthropic.messages.stream({
        model: MODEL_NAME,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        thinking: { type: "adaptive" },
        messages,
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
        } catch { /* ignore */ }
    }
}
