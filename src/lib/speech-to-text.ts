/**
 * Google Cloud Speech-to-Text with Speaker Diarization
 * 話者分離付き文字起こし + 自己紹介からの名前マッピング
 * Vercel Workload Identity Federation対応
 */
import { SpeechClient } from "@google-cloud/speech";
import { google } from "@google-cloud/speech/build/protos/protos";
import { ExternalAccountClient } from "google-auth-library";
import { getVercelOidcToken } from "@vercel/functions/oidc";

// SpeechClientのシングルトンインスタンス
let speechClientInstance: SpeechClient | null = null;

/**
 * Workload Identity Federation対応のSpeechClientを取得
 * Vercel環境ではOIDCトークンを使用し、ローカル環境ではADCを使用
 */
async function getSpeechClient(): Promise<SpeechClient> {
    // すでにインスタンスがあれば再利用
    if (speechClientInstance) {
        return speechClientInstance;
    }

    const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID;

    // Vercel環境（WIF設定がある場合）
    if (
        process.env.GCP_WORKLOAD_IDENTITY_PROVIDER &&
        process.env.GCP_SERVICE_ACCOUNT_EMAIL
    ) {
        console.log("[Speech-to-Text] Using Workload Identity Federation for authentication");

        try {
            // Vercel OIDCトークンを取得
            const oidcToken = await getVercelOidcToken();
            if (!oidcToken) {
                throw new Error("Failed to get Vercel OIDC token");
            }

            // WIF認証クライアントを作成
            const authClient = ExternalAccountClient.fromJSON({
                type: "external_account",
                audience: `//iam.googleapis.com/${process.env.GCP_WORKLOAD_IDENTITY_PROVIDER}`,
                subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
                token_url: "https://sts.googleapis.com/v1/token",
                service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${process.env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
                subject_token_supplier: {
                    getSubjectToken: async () => oidcToken,
                },
            });

            if (!authClient) {
                throw new Error("Failed to create external account client");
            }

            speechClientInstance = new SpeechClient({
                authClient,
                projectId,
            });

            console.log("[Speech-to-Text] Successfully created SpeechClient with WIF");
            return speechClientInstance;
        } catch (error) {
            console.error("[Speech-to-Text] WIF authentication failed, falling back to ADC:", error);
            // フォールバック: ADCを使用
        }
    }

    // ローカル環境またはフォールバック（ADC使用）
    console.log("[Speech-to-Text] Using Application Default Credentials (ADC)");
    speechClientInstance = new SpeechClient({
        projectId,
    });

    return speechClientInstance;
}

// 話者マッピング結果
export interface SpeakerMapping {
    [speakerTag: string]: string; // "1" → "田中太郎"
}

// 話者付き発話セグメント
export interface SpeakerSegment {
    speakerTag: number;
    speakerName: string;
    text: string;
    startTime: number;
    endTime: number;
}

// 文字起こし結果
export interface TranscriptionResult {
    fullText: string;
    speakerSegments: SpeakerSegment[];
    speakerMapping: SpeakerMapping;
    formattedTranscript: string; // 「田中: こんにちは」形式
}

// 自己紹介パターン（「〇〇です」「〇〇と申します」など）
// 会議冒頭で参加者が自己紹介するときのパターンを網羅
const INTRO_PATTERNS = [
    // 基本パターン
    /^(.{1,10})です[。、]?$/,
    /^(.{1,10})と申します/,
    /^私[は、](.{1,10})です/,
    /^(.{1,10})といいます/,
    /^(.{1,10})と言います/,
    /^(.{1,10})っていいます/,
    // 挨拶付きパターン
    /^はじめまして[、。]?(.{1,10})です/,
    /^よろしくお願いします[、。]?(.{1,10})です/,
    /^おはようございます[、。]?(.{1,10})です/,
    /^お疲れ様です[、。]?(.{1,10})です/,
    // 所属付きパターン（所属を除去して名前だけ抽出）
    /^.{1,15}の(.{1,10})です/,
    /^.{1,15}から来ました(.{1,10})です/,
];

/**
 * 発話テキストから名前を抽出
 */
function extractNameFromIntro(text: string): string | null {
    const trimmed = text.trim();

    for (const pattern of INTRO_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match && match[1]) {
            const name = match[1].trim();
            // 名前として妥当かチェック（1-10文字、記号なし）
            if (name.length >= 1 && name.length <= 10 && !/[。、！？!?]/.test(name)) {
                return name;
            }
        }
    }
    return null;
}

/**
 * Google Cloud Speech-to-Text で話者分離付き文字起こし
 */
export async function transcribeWithSpeakerDiarization(
    audioContent: Buffer,
    encoding: google.cloud.speech.v1.RecognitionConfig.AudioEncoding =
        google.cloud.speech.v1.RecognitionConfig.AudioEncoding.WEBM_OPUS,
    sampleRateHertz: number = 48000,
    maxSpeakers: number = 6
): Promise<TranscriptionResult> {
    // WIF対応のSpeechClientを取得
    const client = await getSpeechClient();

    const request: google.cloud.speech.v1.ILongRunningRecognizeRequest = {
        config: {
            encoding,
            sampleRateHertz,
            languageCode: "ja-JP",
            enableAutomaticPunctuation: true,
            diarizationConfig: {
                enableSpeakerDiarization: true,
                minSpeakerCount: 2,
                maxSpeakerCount: maxSpeakers,
            },
            model: "latest_long", // 長時間音声用モデル
        },
        audio: {
            content: audioContent.toString("base64"),
        },
    };

    console.log("[Speech-to-Text] Starting transcription with speaker diarization...");

    // 長時間音声用の非同期処理
    const [operation] = await client.longRunningRecognize(request);
    const [response] = await operation.promise();

    if (!response.results || response.results.length === 0) {
        return {
            fullText: "",
            speakerSegments: [],
            speakerMapping: {},
            formattedTranscript: "",
        };
    }

    // 話者付きセグメントを抽出
    const speakerSegments: SpeakerSegment[] = [];
    const speakerMapping: SpeakerMapping = {};

    // 最後のresultに全体のword-level話者情報が含まれる
    const lastResult = response.results[response.results.length - 1];
    const words = lastResult.alternatives?.[0]?.words || [];

    let currentSegment: { speakerTag: number; words: string[]; startTime: number; endTime: number } | null = null;

    for (const word of words) {
        const speakerTag = word.speakerTag || 0;
        const wordText = word.word || "";
        const startTime = Number(word.startTime?.seconds || 0) + Number(word.startTime?.nanos || 0) / 1e9;
        const endTime = Number(word.endTime?.seconds || 0) + Number(word.endTime?.nanos || 0) / 1e9;

        if (currentSegment && currentSegment.speakerTag === speakerTag) {
            // 同じ話者の発話を継続
            currentSegment.words.push(wordText);
            currentSegment.endTime = endTime;
        } else {
            // 話者が変わった
            if (currentSegment) {
                const text = currentSegment.words.join("");
                speakerSegments.push({
                    speakerTag: currentSegment.speakerTag,
                    speakerName: `話者${currentSegment.speakerTag}`,
                    text,
                    startTime: currentSegment.startTime,
                    endTime: currentSegment.endTime,
                });
            }
            currentSegment = {
                speakerTag,
                words: [wordText],
                startTime,
                endTime,
            };
        }
    }

    // 最後のセグメントを追加
    if (currentSegment) {
        const text = currentSegment.words.join("");
        speakerSegments.push({
            speakerTag: currentSegment.speakerTag,
            speakerName: `話者${currentSegment.speakerTag}`,
            text,
            startTime: currentSegment.startTime,
            endTime: currentSegment.endTime,
        });
    }

    // 自己紹介から名前を抽出（最初の数セグメントをチェック）
    const introCheckLimit = Math.min(speakerSegments.length, 20);
    for (let i = 0; i < introCheckLimit; i++) {
        const segment = speakerSegments[i];
        const speakerKey = String(segment.speakerTag);

        // まだマッピングされていない話者のみチェック
        if (!speakerMapping[speakerKey]) {
            const extractedName = extractNameFromIntro(segment.text);
            if (extractedName) {
                speakerMapping[speakerKey] = extractedName;
                console.log(`[Speech-to-Text] Mapped Speaker ${speakerKey} → ${extractedName}`);
            }
        }
    }

    // セグメントに名前を反映
    for (const segment of speakerSegments) {
        const speakerKey = String(segment.speakerTag);
        if (speakerMapping[speakerKey]) {
            segment.speakerName = speakerMapping[speakerKey];
        }
    }

    // フォーマット済みトランスクリプト生成
    const formattedTranscript = speakerSegments
        .map((seg) => `${seg.speakerName}: ${seg.text}`)
        .join("\n");

    // フルテキスト（話者区別なし）
    const fullText = speakerSegments.map((seg) => seg.text).join("");

    console.log(`[Speech-to-Text] Transcription complete. ${speakerSegments.length} segments, ${Object.keys(speakerMapping).length} speakers identified.`);

    return {
        fullText,
        speakerSegments,
        speakerMapping,
        formattedTranscript,
    };
}

/**
 * 短い音声用の同期処理（1分未満）
 */
export async function transcribeShortAudio(
    audioContent: Buffer,
    encoding: google.cloud.speech.v1.RecognitionConfig.AudioEncoding =
        google.cloud.speech.v1.RecognitionConfig.AudioEncoding.WEBM_OPUS,
    sampleRateHertz: number = 48000
): Promise<TranscriptionResult> {
    // WIF対応のSpeechClientを取得
    const client = await getSpeechClient();

    const request: google.cloud.speech.v1.IRecognizeRequest = {
        config: {
            encoding,
            sampleRateHertz,
            languageCode: "ja-JP",
            enableAutomaticPunctuation: true,
            diarizationConfig: {
                enableSpeakerDiarization: true,
                minSpeakerCount: 2,
                maxSpeakerCount: 6,
            },
        },
        audio: {
            content: audioContent.toString("base64"),
        },
    };

    const [response] = await client.recognize(request);

    // 以降は longRunningRecognize と同じ処理
    if (!response.results || response.results.length === 0) {
        return {
            fullText: "",
            speakerSegments: [],
            speakerMapping: {},
            formattedTranscript: "",
        };
    }

    // 簡易版: フルテキストのみ返す
    const fullText = response.results
        .map((result) => result.alternatives?.[0]?.transcript || "")
        .join("");

    return {
        fullText,
        speakerSegments: [],
        speakerMapping: {},
        formattedTranscript: fullText,
    };
}
