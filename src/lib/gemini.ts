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
    // 再生成時のフィードバック（修正指示）
    feedback?: string;
    // ユーザーが追加した背景情報メモ
    notes?: string;
    // メンバープロファイル（タスク担当者の精度向上用）
    memberProfiles?: Array<{
        name: string;
        nameVariants?: string[];
        email?: string | null;
        company?: string | null;
        department?: string | null;
        role?: string | null;
        type?: "internal" | "external";
        isParticipant: boolean; // 会議参加者か関連メンバーか
    }>;
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
                console.warn(`⚠️ [Gemini] Timeout waiting for file: ${name} (waited ${MAX_WAIT / 1000}s)`);
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 2_000));
            file = await fileManager.getFile(name);
        }

        if (file.state === FileState.FAILED) {
            console.error(`❌ [Gemini] File FAILED: name=${file.name}, displayName=${file.displayName}, mimeType=${file.mimeType}, size=${file.sizeBytes}`);
            const error = new Error(
                `ファイル "${file.displayName || file.name}" の処理に失敗しました（Gemini側エラー）。ファイルを再アップロードしてリトライします...`
            );
            (error as any).code = "FILE_PROCESSING_FAILED";
            (error as any).failedFileName = file.name;
            throw error;
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
    feedback,
    notes,
    memberProfiles,
}: GenerateStreamParams): AsyncGenerator<string> {
    console.log("🎯 [Gemini] generateEverythingStream called with participants:", participants);
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
        const participantsList = participants.join("、");
        participantsSection = `\n## 👥 会議参加者（確定済み - 必ず使用すること）\n以下の参加者がこの会議に出席しています：\n${participants.map(p => `- ${p}`).join("\n")}\n\n**【最重要】参加メンバー欄について**:\n- 議事録の「【参加メンバー】」欄には、必ず上記の参加者リストをそのまま使用してください\n- 【参加メンバー】 ${participantsList}\n- この参加者リストは音声から推測するのではなく、ユーザーが事前に確定したものです\n- 音声認識で聞き取れなかった人がいても、上記リストの全員を参加者として記載してください`;
    }

    // フィードバックセクション（再生成時の修正指示）
    let feedbackSection = "";
    if (feedback) {
        feedbackSection = `\n## 📝 ユーザーからの修正指示（最優先）\n以下のフィードバックを反映して議事録を作成してください：\n"${feedback}"\n\n**重要**: これは再生成リクエストです。上記の修正指示を特に優先して議事録を改善してください。`;
    }

    // ユーザーメモセクション（背景情報）
    let notesSection = "";
    if (notes) {
        notesSection = `\n## 📌 ユーザーからの補足メモ（背景情報）\n以下はユーザーが会議中に追加したメモです。固有名詞や背景情報として議事録に反映してください：\n"${notes}"\n\n**重要**: このメモの情報を踏まえて、音声内の言及を正確に解釈してください。例えば会社名や製品名の正式名称、専門用語の意味などが含まれている場合があります。`;
    }

    // メンバープロファイルセクション
    let memberProfilesSection = "";
    if (memberProfiles && memberProfiles.length > 0) {
        const participantProfiles = memberProfiles.filter(m => m.isParticipant);
        const relatedProfiles = memberProfiles.filter(m => !m.isParticipant);

        const formatProfile = (m: typeof memberProfiles[0]) => {
            const parts = [`- ${m.name}`];
            if (m.company || m.department || m.role) {
                const orgParts = [m.company, m.department, m.role].filter(Boolean);
                parts[0] += `（${orgParts.join(" / ")}）`;
            }
            if (m.type === "external") parts[0] += " [社外]";
            if (m.nameVariants && m.nameVariants.length > 0) {
                parts[0] += ` ※呼び名: ${m.nameVariants.join("、")}`;
            }
            if (m.email) parts[0] += ` → ${m.email}`;
            return parts[0];
        };

        let section = "\n## 👤 メンバープロファイル（タスク担当者の正確な特定に使用）\n";
        if (participantProfiles.length > 0) {
            section += "### 会議参加者:\n" + participantProfiles.map(formatProfile).join("\n") + "\n";
        }
        if (relatedProfiles.length > 0) {
            section += "### 関連メンバー（会議不参加だがタスクの対象になり得る人）:\n" + relatedProfiles.map(formatProfile).join("\n") + "\n";
        }
        section += "\n**重要**: ネクストアクションの担当者欄には、上記プロファイルの正式名を使用してください。";
        memberProfilesSection = section;
    }

    const mainInstruction = `
${basePrompt}
${modePrompts[mode]}
${terminologySection}
${speakerSection}
${participantsSection}
${feedbackSection}
${notesSection}
${memberProfilesSection}

---
日付: ${date || new Date().toLocaleDateString("ja-JP")}

## 重要な指示
- 提供された音声またはテキストに加え、添付された補足資料（PDF、画像等）の内容を深く読み取ってください。
- 会議の中で「この資料のここ」や「図表の数値」などに言及があった場合、添付資料から該当箇所を特定し、正確な情報（項目名、数値など）を議事録に反映させてください。
- 資料に記載されている専門用語やプロジェクト名、参加者リストなどがある場合は、それらを正確に使用してください。
- **「用語・表記ルール」セクションがある場合、その表記に必ず従ってください。人名、社名、製品名などの固有名詞は特に正確に記載してください。**

## 🚨 最重要：内容不足時の対応（ハルシネーション防止）
**音声やテキストの内容が不十分な場合（無音、ごく短い、意味のある会話がない等）は、絶対に架空の内容を作成しないでください。**

以下の場合は、議事録を生成せず、代わりに以下の形式で報告してください：
- 音声が無音または認識できる発言がほとんどない
- 録音が極端に短い（10秒未満等）
- 意味のある会議内容が確認できない

\`\`\`
[MINUTES_START]
# 議事録を生成できませんでした

音声データを確認しましたが、以下の理由により議事録を生成できません：

- **理由**: [具体的な理由を記載（例：「録音が約5秒と極端に短く、意味のある発言が確認できませんでした」）]

再度録音していただくか、別の音声ファイルをアップロードしてください。
[MINUTES_END]
\`\`\`

**絶対に禁止事項：**
- 存在しない会議内容を創作すること
- 「恐らくこのような話があった」という推測で議事録を作成すること
- 音声にない決定事項やアクションアイテムを捏造すること

## 話者識別について
- **必ず話者（発言者）を区別して識別してください。** 声のトーン、話し方、発言内容から話者を判別してください。
- 用語・表記ルールに参加者名がある場合は、発言内容や文脈から話者を特定し、その名前を使用してください。
- 名前が特定できない場合は「話者A」「話者B」のように区別して記載してください。
- 議事録には発言者が誰かを明確に記載してください（例：「田中：〇〇について説明」「話者A：〇〇と提案」）。

## 🎯 ネクストアクション抽出（最重要セクション）
**ネクストアクションは絶対に漏らさず、全て余すことなく抽出してください。**
**拾い漏れは信頼低下に直結します。誤検出はユーザーが消すだけなので、迷ったら必ず含めてください。**

### 抽出ルール:
1. **全ての発言を精査**: 会議のあらゆる箇所で言及されたタスク・宿題・依頼を全て抽出すること
2. **暗黙のタスクも抽出**: 「〇〇について確認する」「〇〇を検討しておく」「〇〇を共有する」「〇〇をまとめておく」など、直接的な指示でなくても実質的なタスクとなるものは全て含める
3. **担当者を明確に**: 誰が実行するタスクか必ず特定すること。文脈から推定できる場合はその人を担当者とし、不明な場合は「要確認」と記載
4. **期限を可能な限り YYYY-MM-DD 形式で記載**: 明示的な期限がある場合はその日付を YYYY-MM-DD 形式に変換して記載。「来週金曜」「月末まで」等の相対表現も可能な限り具体的な日付に変換。暗黙の期限（「来週までに」「次回MTGまでに」「なるべく早く」等）も含める。期限が不明な場合は「期限未定」と記載
5. **拾い漏れチェック（必須）**: 議事録を作成した後、**全ての発言を最初から最後まで再度スキャンし**、タスク・アクション・宿題・依頼・確認事項・To-Doに該当するものが漏れていないか最終確認すること。**1件でも漏れがあればアプリの価値を損なう**
6. **多すぎることより少なすぎることが問題**: 迷ったらネクストアクションに含めてください。拾いすぎて困ることはありません
7. **「〜する」「〜を行う」「〜を進める」「〜を連絡する」「〜を送る」「〜を調べる」「〜を準備する」「〜を確認する」「〜を手配する」「〜をまとめる」「〜を報告する」などの動詞表現** は全てアクション候補として検討すること
8. **重複排除**: 同一担当者 × 同一内容のタスクのみ重複とみなす。担当者が異なれば別タスクとして出力

### 優先度の判定基準:
- **critical（緊急）**: 他タスクがブロックされる / 外部への影響がある / 当日〜翌日期限
- **high（高）**: 明示的な期限あり（3日以内）/ 上位者からの依頼
- **medium（中）**: 期限に余裕あり（1〜2週間）/ 通常業務
- **low（低）**: 期限なし / 検討事項 / 長期的な課題

### ネクストアクションの出力フォーマット:
| ID | アクション内容 | 担当者 | 期限 | 優先度 | 備考 |
|:---|:---|:---|:---|:---|:---|

## フォーマットについて（重要）
**会議概要は必ず以下の形式で、各項目を別々の行に記載してください（1行に複数項目を入れないでください）：**

\`\`\`
■ 会議概要

【タイトル】 〇〇会議

【開催日時】 2024年X月X日（X曜日）

【参加メンバー】 〇〇、△△、□□
\`\`\`

**絶対に守ってください：**
- 「■ 会議概要」「【タイトル】」「【開催日時】」「【参加メンバー】」は必ず別々の行に書いてください
- 1行に複数の【】項目を入れてはいけません
- 各項目の間には空行を入れてください
- テーブルは詳細なデータ比較や一覧表示が必要な場合のみ使用してください。

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
