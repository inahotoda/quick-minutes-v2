import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { MeetingMode } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || "");

export const GEMINI_MODEL = "Gemini 3.0 Flash";
const MODEL_NAME = "gemini-flash-latest";


// 話者マッピング（Speech-to-Textから取得）
export interface SpeakerInfo {
    speakerMapping: { [speakerTag: string]: string }; // "1" → "田中"
    formattedTranscript: string; // "田中: こんにちは\n鈴木: よろしく"
}

// 生成用パラメータ
interface GenerateStreamParams {
    mode: MeetingMode;
    transcript?: string;
    audioData?: {
        base64?: string;
        mimeType: string;
        fileUri?: string;
    };
    uploadedFiles?: Array<{
        mimeType: string;
        base64?: string;
        name: string;
        fileUri?: string;
    }>;
    date?: string;
    customPrompts?: {
        basePrompt?: string;
        internalPrompt?: string;
        businessPrompt?: string;
        otherPrompt?: string;
        terminology?: string;
    };
    // Speech-to-Textで抽出した話者情報
    speakerInfo?: SpeakerInfo;
    // 参加者確認画面で選択された参加者名リスト
    participants?: string[];
}

/**
 * ファイルのステータスが Active になるまで待機する
 */
export async function waitForFileActive(fileNames: string[]) {
    console.log(`🚀 [Gemini] Waiting for ${fileNames.length} files to be ACTIVE...`);

    const checkFile = async (name: string) => {
        let file = await fileManager.getFile(name);
        const startTime = Date.now();
        const MAX_WAIT = 120_000; // 2分

        while (file.state === FileState.PROCESSING) {
            if (Date.now() - startTime > MAX_WAIT) {
                console.warn(`⚠️ [Gemini] Timeout waiting for file: ${name}`);
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            file = await fileManager.getFile(name);
        }

        if (file.state === FileState.FAILED) {
            throw Error(`File ${file.name} failed to process (FAILED state)`);
        }
        console.log(`✅ [Gemini] File is now ACTIVE: ${name}`);
    };

    await Promise.all(fileNames.map(name => checkFile(name)));
    console.log("🚀 [Gemini] All files are ready to use");
}

/**
 * 音声やテキストから直接、議事録をストリーミング生成する
 * (文字起こしは不要とのことで、議事録のみに特化)
 */
export async function* generateEverythingStream({
    mode,
    transcript,
    audioData,
    uploadedFiles,
    date,
    customPrompts,
    speakerInfo,
    participants,
}: GenerateStreamParams): AsyncGenerator<string> {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    const basePrompt =
        customPrompts?.basePrompt ||
        `あなたは優秀な議事録作成アシスタントです。提供された音声またはテキストから、構造化された議事録を作成してください。`;

    const modePrompts: Record<MeetingMode, string> = {
        internal: customPrompts?.internalPrompt || `## 社内MTGモード\n- 決定事項とアクションアイテムを明確に。`,
        business: customPrompts?.businessPrompt || `## 商談モード\n- 顧客の課題とネクストアクションを整理。`,
        other: customPrompts?.otherPrompt || `## その他モード\n- 要点を簡潔に。`,
    };

    const terminologySection = customPrompts?.terminology
        ? `\n## 用語・表記ルール\n${customPrompts.terminology}`
        : "";

    // 話者情報セクション（Speech-to-Textで抽出された場合）
    let speakerSection = "";
    if (speakerInfo && Object.keys(speakerInfo.speakerMapping).length > 0) {
        const speakerList = Object.entries(speakerInfo.speakerMapping)
            .map(([tag, name]) => `- ${name}（話者${tag}）`)
            .join("\n");
        speakerSection = `\n## 🎯 話者情報（自動認識済み）\n以下の話者が会議冒頭の自己紹介から特定されました：\n${speakerList}\n\n**重要**: 以下に提供する話者付きトランスクリプトの話者名を正確に使用してください。`;
    }

    // 参加者セクション（参加者確認画面で選択された場合）
    let participantsSection = "";
    if (participants && participants.length > 0) {
        participantsSection = `\n## 👥 会議参加者（事前に確認済み）\n以下の参加者がこの会議に出席しています：\n${participants.map(p => `- ${p}`).join("\n")}\n\n**重要**: 話者識別では上記の参加者名を使用してください。「話者A」「話者B」ではなく、可能な限り実際の参加者名で発言者を記載してください。`;
    }

    const mainInstruction = `
${basePrompt}
${modePrompts[mode]}
${terminologySection}
${speakerSection}
${participantsSection}

---
日付: ${date || new Date().toLocaleDateString("ja-JP")}

## 重要な指示
- 提供された音声またはテキストに加え、添付された補足資料（PDF、画像等）の内容を深く読み取ってください。
- 会議の中で「この資料のここ」や「図表の数値」などに言及があった場合、添付資料から該当箇所を特定し、正確な情報（項目名、数値など）を議事録に反映させてください。
- 資料に記載されている専門用語やプロジェクト名、参加者リストなどがある場合は、それらを正確に使用してください。
- **「用語・表記ルール」セクションがある場合、その表記に必ず従ってください。人名、社名、製品名などの固有名詞は特に正確に記載してください。**

## 話者識別について
- **必ず話者（発言者）を区別して識別してください。** 声のトーン、話し方、発言内容から話者を判別してください。
- 用語・表記ルールに参加者名がある場合は、発言内容や文脈から話者を特定し、その名前を使用してください。
- 名前が特定できない場合は「話者A」「話者B」のように区別して記載してください。
- 議事録には発言者が誰かを明確に記載してください（例：「田中：〇〇について説明」「話者A：〇〇と提案」）。

## フォーマットについて
- **会議概要（冒頭部分）はテーブル形式ではなく、必ず以下の形式で各項目を改行して記載してください：**

■ 会議概要
【タイトル】 〇〇会議
【開催日時】 2024年X月X日（X曜日）XX:XX〜XX:XX
【参加メンバー】 〇〇、△△、□□

- 上記のように「■ 会議概要」の後に改行し、各【】項目も1行ずつ改行してください。
- テーブルは詳細なデータ比較や一覧表示が必要な場合のみ使用してください。
- 適切な改行とインデントを使用して視認性を高めてください。

出力は必ず以下の形式に従ってください（文字起こしは不要です）：

[MINUTES_START]
(ここに構造化された議事録をMarkdownで記述)
[MINUTES_END]
`;

    const contents: any[] = [{ text: mainInstruction }];

    // 録音データ
    if (audioData) {
        if (audioData.fileUri) {
            contents.push({
                fileData: { mimeType: audioData.mimeType, fileUri: audioData.fileUri }
            });
        } else if (audioData.base64) {
            contents.push({
                inlineData: { mimeType: audioData.mimeType, data: audioData.base64 }
            });
        }
        contents.push({ text: "メインの会議音声です。" });
    }

    // Speech-to-Textで作成した話者付きトランスクリプト（最優先）
    if (speakerInfo?.formattedTranscript) {
        contents.push({
            text: `## 話者付き文字起こし（Speech-to-Text）\n以下は会議音声の正確な文字起こしです。各発言の話者名を維持してください：\n\n${speakerInfo.formattedTranscript}`
        });
    }

    // 既存のテキスト入力
    if (transcript) {
        contents.push({ text: `参考テキスト（事前の議題など）:\n${transcript}` });
    }

    // アップロードファイル（補足資料）
    if (uploadedFiles) {
        for (const file of uploadedFiles) {
            if (file.fileUri) {
                contents.push({
                    fileData: { mimeType: file.mimeType, fileUri: file.fileUri }
                });
            } else if (file.base64) {
                contents.push({
                    inlineData: { mimeType: file.mimeType, data: file.base64 }
                });
            }
            contents.push({ text: `会議の補足資料「${file.name}」です。音声内の言及と結びつけて解釈してください。` });
        }
    }

    const result = await model.generateContentStream(contents);

    for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) yield text;
    }
}

// 互換性のための古い関数
export async function transcribeAudio(audioBase64: string, mimeType: string, terminology?: string): Promise<string> {
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });
    const terminologyPrompt = terminology ? `\n用語ルール:\n${terminology}` : "";
    const result = await model.generateContent([
        { inlineData: { mimeType, data: audioBase64 } },
        { text: `この音声を文字起こししてください。${terminologyPrompt}` }
    ]);
    return result.response.text();
}

export { fileManager };
