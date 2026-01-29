import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { MeetingMode } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY || "");

export const GEMINI_MODEL = "Gemini 3.0 Flash";
const MODEL_NAME = "gemini-flash-latest";


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

    const mainInstruction = `
${basePrompt}
${modePrompts[mode]}
${terminologySection}

---
日付: ${date || new Date().toLocaleDateString("ja-JP")}

## 重要な指示
- 提供された音声またはテキストに加え、添付された補足資料（PDF、画像等）の内容を深く読み取ってください。
- 会議の中で「この資料のここ」や「図表の数値」などに言及があった場合、添付資料から該当箇所を特定し、正確な情報（項目名、数値など）を議事録に反映させてください。
- 資料に記載されている専門用語やプロジェクト名、参加者リストなどがある場合は、それらを正確に使用してください。
- **「用語・表記ルール」セクションがある場合、その表記に必ず従ってください。人名、社名、製品名などの固有名詞は特に正確に記載してください。**

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
