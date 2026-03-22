"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSession, signIn } from "next-auth/react";
import { MeetingMode, UploadedFile } from "@/types";
import { MeetingPreset, MeetingDuration } from "@/lib/member-storage";
import { useAudioRecorder, blobToBase64 } from "@/hooks/useAudioRecorder";

import LoginButton from "@/components/LoginButton";
import RecordButton from "@/components/RecordButton";
import ModeSelector from "@/components/ModeSelector";
import TimerSelector from "@/components/TimerSelector";
import TimerEndModal from "@/components/TimerEndModal";
import FileUpload from "@/components/FileUpload";
import TranscriptInput from "@/components/TranscriptInput";
import MinutesEditor from "@/components/MinutesEditor";
import ProcessingScreen from "@/components/ProcessingScreen";
import IntroductionScreen from "@/components/IntroductionScreen";
import ParticipantConfirmation, { ConfirmedParticipant, ParticipantEditButton } from "@/components/ParticipantConfirmation";
import Image from "next/image";
import styles from "./page.module.css";
import { uploadToGemini } from "@/lib/gemini-client";
import { findFolderByName, createFolder, uploadMarkdownAsDoc, uploadAudioFile, uploadPdfFile } from "@/lib/drive-client";

// FileをBase64に変換
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const APP_VERSION = "v4.24.0";
type AppState = "idle" | "confirming" | "uploadConfirming" | "introduction" | "recording" | "uploading" | "processing" | "editing";

// Markdownからプレーンテキストを抽出
const stripMarkdown = (markdown: string) => {
  return markdown
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/- \[( |x)\] /g, "- ")
    .replace(/\|/g, " ")
    .trim();
};

export default function Home() {
  const { data: session, status } = useSession();

  // App state
  const [appState, setAppState] = useState<AppState>("idle");
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [mode, setMode] = useState<MeetingMode>("internal");
  const [selectedPreset, setSelectedPreset] = useState<MeetingPreset | null>(null);
  const [transcript, setTranscript] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [minutes, setMinutes] = useState("");
  const [modelVersion, setModelVersion] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPwaMode, setIsPwaMode] = useState(false);
  const [confirmedParticipants, setConfirmedParticipants] = useState<ConfirmedParticipant[]>([]);
  const [showParticipantEdit, setShowParticipantEdit] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<MeetingDuration>(30);
  const [showTimerEndModal, setShowTimerEndModal] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [additionalPrompt, setAdditionalPrompt] = useState("");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [lastGenerationParams, setLastGenerationParams] = useState<{
    audioData?: { fileUri?: string; fileId?: string; base64?: string };
    uploadedFiles?: any[];
    participants?: string[];
  } | null>(null);

  // Trial mode: PDF事前生成用
  const pdfBlobRef = useRef<Blob | null>(null);
  const pdfFileNameRef = useRef<string>("");
  const [isPdfReady, setIsPdfReady] = useState(false);
  const pdfGenerationIdRef = useRef(0); // 世代管理用
  const [isMinutesEditing, setIsMinutesEditing] = useState(false); // MinutesEditorの編集状態

  // Access check state
  const [accessCheckState, setAccessCheckState] = useState<"checking" | "granted" | "denied">("checking");
  const [accessError, setAccessError] = useState<{ message: string; requestUrl?: string } | null>(null);

  // Trial mode state
  const isTrialDeployment = process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === "trial";
  const [trialInfo, setTrialInfo] = useState<{
    companyName?: string;
    daysRemaining?: number;
    expired?: boolean;
  } | null>(null);

  // Audio recorder
  const recorder = useAudioRecorder();

  // Check folder access or tenant after login (only once)
  useEffect(() => {
    if (session && status === "authenticated" && accessCheckState === "checking") {
      if (isTrialDeployment) {
        // Trial mode: check tenant instead of Drive access
        fetch("/api/check-tenant")
          .then(res => res.json())
          .then(data => {
            if (data.allowed) {
              setAccessCheckState("granted");
              setTrialInfo({
                companyName: data.companyName,
                daysRemaining: data.daysRemaining,
              });
            } else if (data.reason === "trial_expired") {
              setAccessCheckState("denied");
              setTrialInfo({ expired: true, companyName: data.companyName });
              setAccessError({ message: "モニター期間が終了しました" });
            } else {
              setAccessCheckState("denied");
              setAccessError({ message: "このドメインはモニター対象に登録されていません" });
            }
          })
          .catch(err => {
            console.error("Tenant check failed:", err);
            setAccessCheckState("denied");
            setAccessError({ message: "テナントの確認に失敗しました" });
          });
      } else {
        // Normal mode: check Google Drive access
        fetch("/api/check-access")
          .then(res => res.json())
          .then(data => {
            if (data.hasAccess) {
              setAccessCheckState("granted");
            } else {
              setAccessCheckState("denied");
              setAccessError({
                message: data.error || "共有フォルダへのアクセス権がありません",
                requestUrl: data.requestAccessUrl
              });
            }
          })
          .catch(err => {
            console.error("Access check failed:", err);
            setAccessCheckState("denied");
            setAccessError({ message: "アクセス権の確認に失敗しました" });
          });
      }
    }
  }, [session, status, accessCheckState, isTrialDeployment]);

  // Browser detection
  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isStandalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;

    // iOSかつPWAモード（ホーム画面から起動）の場合に警告を出す
    if (isIos && isStandalone) {
      setIsPwaMode(true);
    }

    // Service Worker登録（オフライン対応）
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered:', registration.scope);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  // 録音中または未保存の議事録がある場合はページを閉じる・リロード時に警告を表示
  useEffect(() => {
    const isRecordingActive = appState === "recording" || appState === "confirming" || appState === "introduction";
    const hasUnsavedMinutes = appState === "editing" && !isSaved;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isRecordingActive) {
        e.preventDefault();
        e.returnValue = "録音中です。本当にページを離れますか？";
        return e.returnValue;
      }
      if (hasUnsavedMinutes) {
        e.preventDefault();
        e.returnValue = "議事録が保存されていません。本当にページを離れますか？";
        return e.returnValue;
      }
    };

    if (isRecordingActive || hasUnsavedMinutes) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [appState, isSaved]);

  // セッション復元処理（マウント時）
  useEffect(() => {
    const backupStr = sessionStorage.getItem("quickMinutesBackup");
    if (backupStr && status === "authenticated") {
      try {
        const backup = JSON.parse(backupStr);
        if (backup && backup.minutes) {
          console.log("🔄 Restoring state from backup...");
          setMinutes(backup.minutes);
          setTranscript(backup.transcript || "");
          if (backup.participants) setConfirmedParticipants(backup.participants);
          if (backup.mode) setMode(backup.mode);
          setAppState("editing"); // 編集画面に戻す
          // 復元後、バックアップをクリア
          sessionStorage.removeItem("quickMinutesBackup");
          alert("✓ 再ログインが完了し、議事録データを復元しました。\n再度「ドライブへ保存」をお試しください。");
        }
      } catch (err) {
        console.error("Failed to restore backup:", err);
        sessionStorage.removeItem("quickMinutesBackup");
      }
    }
  }, [status]);

  // Handle recording start - always go to participant confirmation
  const handleStartRecording = useCallback(async () => {
    setError(null);
    await recorder.startRecording();
    // 常に参加者確認画面へ遷移
    setAppState("confirming");
  }, [recorder]);

  // Handle participant confirmation complete
  const handleParticipantConfirm = useCallback((participants: ConfirmedParticipant[]) => {
    setConfirmedParticipants(participants);
    recorder.resetDuration(); // タイマーをリセット（ミーティングスタート時からカウント開始）
    setAppState("recording");
  }, [recorder]);

  // Handle participant confirmation cancel
  const handleParticipantCancel = useCallback(() => {
    recorder.stopRecording();
    recorder.resetRecording();
    setAppState("idle");
  }, [recorder]);

  // Handle introduction complete - move to main recording with participants
  const handleIntroductionComplete = useCallback((participants: ConfirmedParticipant[]) => {
    setConfirmedParticipants(participants);
    setAppState("recording");
  }, []);

  // Handle introduction skip - move directly to recording
  const handleIntroductionSkip = useCallback(() => {
    setAppState("recording");
  }, []);

  // Handle timer time up - show modal
  const handleTimeUp = useCallback(() => {
    setShowTimerEndModal(true);
  }, []);

  // Handle timer end - stop recording
  const handleTimerEnd = useCallback(async () => {
    setShowTimerEndModal(false);
    await handleStopRecording();
  }, []);

  // Handle timer extend (without break)
  const handleTimerExtend = useCallback((duration: number) => {
    setShowTimerEndModal(false);
    setSelectedDuration(duration as MeetingDuration);
    recorder.resetDuration(); // Reset timer for new countdown
  }, [recorder]);

  // Handle timer extend with break
  const handleTimerExtendWithBreak = useCallback((duration: number) => {
    setShowTimerEndModal(false);
    setSelectedDuration(duration as MeetingDuration);
    recorder.resetDuration(); // Reset timer for new countdown
  }, [recorder]);

  // Handle recording stop
  const handleStopRecording = useCallback(async () => {
    try {
      setAppState("uploading");
      const blob = await recorder.stopRecording();
      await generateMinutes(blob);
    } catch (err) {
      console.error("Recording stop error:", err);
      setError("録音の停止中にエラーが発生しました");
      setAppState("idle");
    }
  }, [recorder]);

  // Generate minutes from audio, transcript, or uploaded files
  const generateMinutes = async (audioBlob?: Blob, passedParticipants?: ConfirmedParticipant[]) => {
    // 引数で渡された参加者があればそれを使用、なければstateを使用
    const participantsToUse = passedParticipants || confirmedParticipants;
    // オフラインチェック
    if (!navigator.onLine) {
      setError("オフラインです。議事録生成にはインターネット接続が必要です。");
      // 音声データがある場合はダウンロードを促す
      if (audioBlob || recorder.audioBlob) {
        const blobToSave = audioBlob || recorder.audioBlob;
        const shouldDownload = window.confirm(
          "📶 オフラインのため議事録を生成できません。\n\n大切な録音データを保護するため、音声ファイルをダウンロードしますか？\n\n※ ネットワーク復旧後、ファイルアップロードから議事録を生成できます。"
        );
        if (shouldDownload && blobToSave) {
          const url = URL.createObjectURL(blobToSave);
          const a = document.createElement("a");
          a.href = url;
          a.download = `会議録音_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.m4a`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      }
      return;
    }

    setAppState("uploading");
    setUploadProgress("Geminiにファイルをアップロード中...");
    setError(null);

    try {
      console.log("🔍 [DEBUG] participantsToUse:", participantsToUse);
      const requestBody: Record<string, unknown> = {
        mode,
        date: new Date().toLocaleDateString("ja-JP"),
        participants: participantsToUse.map(p => p.name),
      };

      // 追加プロンプト（初回生成時の追加指示）
      if (additionalPrompt.trim()) {
        requestBody.feedback = additionalPrompt.trim();
      }

      // メモ（背景情報）
      if (meetingNotes.trim()) {
        requestBody.notes = meetingNotes.trim();
      }

      // 1. Gemini File API へ直接アップロード (ブラウザから)

      // Handle live recording audio
      if (audioBlob) {
        setUploadProgress("音声をアップロード中...");
        const uploadResult = await uploadToGemini(audioBlob, "Meeting Recording");
        requestBody.audioData = {
          mimeType: audioBlob.type,
          fileUri: uploadResult.file.uri,
          fileId: uploadResult.file.name,
        };
      }

      // Handle uploaded files
      if (files.length > 0) {
        setUploadProgress(`資料をアップロード中 (0/${files.length})...`);
        const uploadedGeminiFiles = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          setUploadProgress(`資料をアップロード中 (${i + 1}/${files.length}): ${f.name}`);
          const uploadResult = await uploadToGemini(f.file, f.name);
          uploadedGeminiFiles.push({
            name: f.name,
            mimeType: f.file.type,
            fileUri: uploadResult.file.uri,
            fileId: uploadResult.file.name,
          });
        }
        requestBody.uploadedFiles = uploadedGeminiFiles;
      }

      // Check if we have any input
      if (!audioBlob && !transcript && files.length === 0) {
        setError("録音データ、文字起こしテキスト、またはファイルが必要です");
        setAppState("idle");
        return;
      }

      // 2. サーバーサイドで議事録を生成 (URIのみ渡す)
      if (transcript) {
        requestBody.transcript = transcript;
      }

      setAppState("processing");
      setUploadProgress("");

      // 再生成用にパラメータを保存
      setLastGenerationParams({
        audioData: requestBody.audioData as { fileUri?: string; fileId?: string; base64?: string } | undefined,
        uploadedFiles: requestBody.uploadedFiles as any[] | undefined,
        participants: participantsToUse.map(p => p.name),
      });

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "議事録の生成に失敗しました");
      }

      // モデルバージョンをヘッダーから取得
      const ver = response.headers.get("X-Model-Version");
      if (ver) {
        setModelVersion(decodeURIComponent(ver));
      }

      const reader = response.body?.getReader();
      const textDecoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        setMinutes("");

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = textDecoder.decode(value, { stream: true });
          fullText += chunk;

          // モデルバージョンの抽出
          const modelMatch = fullText.match(/\[MODEL_VERSION:([\s\S]*?)\]/);
          if (modelMatch) {
            setModelVersion(modelMatch[1]);
          }

          // 議事録パートの抽出
          const minutesMatch = fullText.match(/\[MINUTES_START\]([\s\S]*?)(\[MINUTES_END\]|$)/);
          if (minutesMatch) {
            const currentMinutes = minutesMatch[1].trim();
            if (currentMinutes && appState !== "editing") {
              setAppState("editing"); // 内容が出始めた瞬間に画面切り替え
            }
            setMinutes(currentMinutes);
          }
        }
      }
    } catch (err) {
      // ネットワークエラーかどうかを判定
      const isNetworkError = !navigator.onLine ||
        (err instanceof TypeError && err.message.includes("fetch")) ||
        (err instanceof Error && (err.message.includes("Load failed") || err.message.includes("network")));

      const errorMessage = isNetworkError
        ? "ネットワーク接続に失敗しました。インターネット接続を確認してください。"
        : (err instanceof Error ? err.message : "エラーが発生しました");
      setError(errorMessage);
      // processing 状態を維持し、ProcessingScreen のエラー表示で
      // 音声ダウンロード・リトライ・トップに戻るを提供する
      setAppState("processing");
    }
  };

  // Handle regeneration (with optional feedback)
  const handleRegenerate = async (feedback?: string) => {
    if (!lastGenerationParams) {
      setError("再生成に必要なデータがありません");
      return;
    }

    setIsRegenerating(true);
    setError(null);
    setIsSaved(false);

    try {
      const requestBody: Record<string, unknown> = {
        mode,
        date: new Date().toLocaleDateString("ja-JP"),
        participants: lastGenerationParams.participants || confirmedParticipants.map(p => p.name),
        audioData: lastGenerationParams.audioData,
        uploadedFiles: lastGenerationParams.uploadedFiles,
      };

      if (transcript) {
        requestBody.transcript = transcript;
      }

      // フィードバックがある場合は追加
      if (feedback) {
        requestBody.feedback = feedback;
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "議事録の再生成に失敗しました");
      }

      // モデルバージョンをヘッダーから取得
      const ver = response.headers.get("X-Model-Version");
      if (ver) {
        setModelVersion(decodeURIComponent(ver));
      }

      const reader = response.body?.getReader();
      const textDecoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        setMinutes("");

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = textDecoder.decode(value, { stream: true });
          fullText += chunk;

          // モデルバージョンの抽出
          const modelMatch = fullText.match(/\[MODEL_VERSION:([\s\S]*?)\]/);
          if (modelMatch) {
            setModelVersion(modelMatch[1]);
          }

          // 議事録パートの抽出
          const minutesMatch = fullText.match(/\[MINUTES_START\]([\s\S]*?)(\[MINUTES_END\]|$)/);
          if (minutesMatch) {
            const currentMinutes = minutesMatch[1].trim();
            setMinutes(currentMinutes);
          }
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "再生成エラー";
      setError(errorMessage);
    } finally {
      setIsRegenerating(false);
    }
  };

  // Handle generate from transcript or files
  const handleGenerateFromInput = () => {
    if (!transcript.trim() && files.length === 0) {
      setError("文字起こしテキストを入力するか、ファイルをアップロードしてください");
      return;
    }
    // 参加者確認画面へ遷移
    setAppState("uploadConfirming");
  };

  // Handle upload participant confirmation complete
  const handleUploadParticipantConfirm = useCallback((participants: ConfirmedParticipant[]) => {
    setConfirmedParticipants(participants);
    generateMinutes(undefined, participants);  // 参加者を直接渡す
  }, [transcript, files, mode]);

  // Trial mode: PDFをバックグラウンドで事前生成
  // 議事録が表示/変更されたタイミングでPDFを生成しておき、
  // ボタンタップ時に navigator.share を即座に呼べるようにする
  const generatePdfInBackground = useCallback(async (currentMinutes: string) => {
    if (!isTrialDeployment || !currentMinutes) return;

    const generationId = ++pdfGenerationIdRef.current;
    setIsPdfReady(false);
    pdfBlobRef.current = null;

    try {
      // DOMの描画完了を待つ
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const previewEl = document.querySelector('[data-minutes-preview]') as HTMLElement;
      if (!previewEl) return;

      // 世代チェック（古い生成を無視）
      if (generationId !== pdfGenerationIdRef.current) return;

      const html2pdf = (await import('html2pdf.js')).default;

      const clone = previewEl.cloneNode(true) as HTMLElement;
      const pdfContainer = document.createElement('div');
      pdfContainer.style.cssText = 'position:fixed;left:-9999px;top:0;width:210mm;background:#ffffff;color:#000000;padding:15mm;font-family:sans-serif;font-size:11pt;line-height:1.6;';
      pdfContainer.appendChild(clone);
      document.body.appendChild(pdfContainer);

      const topic = extractTopic(currentMinutes);
      const now = new Date();
      const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      const yyyymmdd = jstNow.toISOString().split("T")[0].replace(/-/g, "");
      const meetingIdentifier = topic || "meeting";
      const fileName = `${yyyymmdd}-${meetingIdentifier}.pdf`;

      const pdfOptions = {
        margin: [10, 15, 10, 15] as [number, number, number, number],
        filename: fileName,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const }
      };

      const pdfBlob: Blob = await html2pdf().set(pdfOptions).from(clone).outputPdf('blob');
      document.body.removeChild(pdfContainer);

      // 世代チェック（生成中に新しい生成が始まっていたら破棄）
      if (generationId !== pdfGenerationIdRef.current) return;

      pdfBlobRef.current = pdfBlob;
      pdfFileNameRef.current = fileName;
      setIsPdfReady(true);
      console.log("✅ PDF事前生成完了:", fileName, pdfBlob.size, "bytes");
    } catch (err) {
      console.error("PDF事前生成エラー:", err);
      // 事前生成の失敗はサイレントに処理（ボタンタップ時にフォールバック）
    }
  }, [isTrialDeployment]);

  // 議事録が表示/変更されたら、または編集完了時にPDFを事前生成
  useEffect(() => {
    if (appState === "editing" && isTrialDeployment && minutes && !isMinutesEditing) {
      // debounce: 1秒待ってから生成
      const timer = setTimeout(() => {
        generatePdfInBackground(minutes);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (isMinutesEditing) {
      // 編集中はPDFを無効化（プレビュー要素がDOMにないため）
      pdfBlobRef.current = null;
      setIsPdfReady(false);
    } else if (appState !== "editing") {
      // editing以外の状態ではリセット
      pdfBlobRef.current = null;
      setIsPdfReady(false);
    }
  }, [appState, minutes, isTrialDeployment, isMinutesEditing, generatePdfInBackground]);

  // Handle save to Google Drive - Direct client upload to bypass Vercel limits
  // Trial mode: 事前生成したPDFを navigator.share で保存
  const handleSave = async () => {
    // Trial mode: 事前生成済みPDFを共有シートで保存
    if (isTrialDeployment) {
      setIsSaving(true);
      setError(null);
      try {
        if (!pdfBlobRef.current || !pdfFileNameRef.current) {
          throw new Error("PDFが準備されていません。少々お待ちください。");
        }

        const fileName = pdfFileNameRef.current;
        const pdfBlob = pdfBlobRef.current;

        // navigator.share でPDFを共有
        // textを指定しないとiOSの共有シートでLINEが候補に出ないため、
        // ファイル名をtextとして渡す（「ファイルに保存」時にテキストファイルも生成されるが許容）
        const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
          try {
            await navigator.share({ files: [pdfFile], text: fileName });
          } catch (shareErr: any) {
            // ユーザーが共有シートをキャンセルした場合はエラーにしない
            if (shareErr?.name === 'AbortError') {
              console.log("PDF共有がキャンセルされました");
              return;
            }
            throw shareErr;
          }
        } else {
          // PC/Android → Blobダウンロード
          const url = URL.createObjectURL(pdfBlob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }

        setIsSaved(true);
      } catch (err: any) {
        console.error("PDF save error:", err);
        setError(err instanceof Error ? err.message : "PDFの保存に失敗しました");
        alert(`❌ PDFの保存に失敗しました\n${err instanceof Error ? err.message : ""}`);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // Normal mode: Google Drive upload
    if (!session?.accessToken) {
      alert("⚠️ 保存には再ログインが必要です。一度ログアウトして再度サインインしてください。");
      return;
    }

    setIsSaving(true);
    setError(null);

    const accessToken = session.accessToken as string;
    console.log("🚀 [UPLOAD_RETRY_V3] Direct upload started");

    try {
      const topic = extractTopic(minutes);
      const now = new Date();
      const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      const yyyymmdd = jstNow.toISOString().split("T")[0].replace(/-/g, "");
      const dateFolderName = jstNow.toISOString().split("T")[0]; // YYYY-MM-DD

      // 1. 保存先のベースフォルダID
      const rootFolderId = "1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY";
      const audioRootFolderId = "1zfWmEmsrG7h0GNmz0sHILhBlw-L3NDKr";

      // 2. 議事録用の日付フォルダを探す/作る
      console.log("Client: Searching for date folder...", dateFolderName);
      let dateFolder = await findFolderByName(dateFolderName, rootFolderId, accessToken);
      if (!dateFolder) {
        console.log("Client: Creating date folder...");
        dateFolder = await createFolder(dateFolderName, rootFolderId, accessToken);
      }
      const targetFolderId = dateFolder.id;

      // 3. ファイル名を生成
      // ルール: YYYYMMDD-会議名(プリセットがある場合) or YYYYMMDD-参加者1_参加者2(プリセットがない場合)
      let meetingIdentifier: string;
      if (selectedPreset?.name) {
        // プリセットがある場合は会議名を使用
        meetingIdentifier = selectedPreset.name;
      } else {
        // プリセットがない場合は参加者名を_で連結
        meetingIdentifier = confirmedParticipants.length > 0
          ? confirmedParticipants.map(p => p.name).join("_")
          : "会議";
      }
      const baseFileName = `${yyyymmdd}-${meetingIdentifier}`;

      // 4. 議事録をPDFとして保存
      console.log("Client: Generating PDF from minutes...");

      // html2pdfをdynamic importで読み込む
      const html2pdf = (await import("html2pdf.js")).default;

      // 議事録プレビュー要素を取得（MinutesEditorのプレビュー部分）
      const previewElement = document.querySelector('[data-minutes-preview]');

      if (previewElement) {
        // iOS Safari対策: クローンを使ったPDF生成
        // スクロール位置やoverflow、viewportの影響を完全に排除する
        const pdfContainer = document.createElement('div');
        pdfContainer.id = 'pdf-render-container';
        pdfContainer.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 210mm;
          z-index: -9999;
          opacity: 0;
          pointer-events: none;
          overflow: visible;
          background: white;
        `;

        // クローンを作成してコンテナに追加
        const clone = previewElement.cloneNode(true) as HTMLElement;
        clone.style.cssText = `
          background: white !important;
          color: #333 !important;
          padding: 20px !important;
          font-size: 12pt !important;
          line-height: 1.6 !important;
          overflow: visible !important;
          max-width: 100% !important;
          width: 100% !important;
          max-height: none !important;
          box-sizing: border-box !important;
        `;
        pdfContainer.appendChild(clone);

        // テーブルや見出しのスタイルも調整
        const styleSheet = document.createElement('style');
        styleSheet.id = 'pdf-print-styles';
        styleSheet.textContent = `
          #pdf-render-container * { color: #333 !important; }
          #pdf-render-container > *:first-child > *:first-child {
            margin-top: 0 !important;
          }
          #pdf-render-container h1, #pdf-render-container h2, #pdf-render-container h3 { 
            color: #111 !important; 
            border-bottom: 1px solid #ccc !important; 
            padding-bottom: 0.5rem !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          #pdf-render-container table { 
            border: 1px solid #ddd !important; 
            background: #fafafa !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            width: 100% !important;
            max-width: 100% !important;
            table-layout: fixed !important;
            overflow: hidden !important;
          }
          #pdf-render-container tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          #pdf-render-container th { 
            background: #e8e8e8 !important; 
            color: #111 !important;
            font-weight: bold !important;
          }
          #pdf-render-container td, #pdf-render-container th { 
            border: 1px solid #ddd !important; 
            padding: 4px 6px !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            word-break: break-word !important;
            font-size: 8pt !important;
            vertical-align: top !important;
            overflow: hidden !important;
          }
          /* ID列: 狭く */
          #pdf-render-container td:first-child,
          #pdf-render-container th:first-child {
            width: 6% !important;
            white-space: nowrap !important;
          }
          /* アクション内容列: 広め */
          #pdf-render-container td:nth-child(2),
          #pdf-render-container th:nth-child(2) {
            width: 40% !important;
          }
          /* 担当者列 */
          #pdf-render-container td:nth-child(3),
          #pdf-render-container th:nth-child(3) {
            width: 14% !important;
          }
          /* 期限列 */
          #pdf-render-container td:nth-child(4),
          #pdf-render-container th:nth-child(4) {
            width: 16% !important;
          }
          /* 備考列 */
          #pdf-render-container td:last-child,
          #pdf-render-container th:last-child {
            width: 24% !important;
          }
          #pdf-render-container strong { color: #111 !important; }
          #pdf-render-container p {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            orphans: 3 !important;
            widows: 3 !important;
          }
          #pdf-render-container li {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          #pdf-render-container ul, #pdf-render-container ol {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          #pdf-render-container blockquote {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        `;
        document.head.appendChild(styleSheet);
        document.body.appendChild(pdfContainer);

        // レンダリングのため1フレーム待つ
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        // PDF生成オプション
        const pdfOptions = {
          margin: [10, 15, 10, 15] as [number, number, number, number],
          filename: `${baseFileName}_議事録.pdf`,
          image: { type: 'jpeg' as const, quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            letterRendering: true,
            backgroundColor: '#ffffff',
            scrollX: 0,
            scrollY: 0,
            x: 0,
            y: 0
          },
          jsPDF: {
            unit: 'mm',
            format: 'a4',
            orientation: 'portrait' as const
          },
          pagebreak: {
            mode: ['avoid-all', 'css', 'legacy'],
            before: '.page-break-before',
            after: '.page-break-after',
            avoid: ['table', 'tr', 'thead', 'tbody', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote']
          }
        };

        // PDFを生成してBlobとして取得（クローンからレンダリング）
        const pdfBlob = await html2pdf()
          .set(pdfOptions)
          .from(clone)
          .outputPdf('blob');

        // クリーンアップ: クローンコンテナとスタイルを削除
        document.body.removeChild(pdfContainer);
        document.getElementById('pdf-print-styles')?.remove();

        console.log("Client: PDF generated, size:", pdfBlob.size, "bytes");

        // Google Driveにアップロード
        await uploadPdfFile(`${baseFileName}.pdf`, pdfBlob, targetFolderId, accessToken);
        console.log("Client: PDF uploaded to Drive");
      } else {
        // プレビュー要素が見つからない場合はテキストとして保存
        console.warn("Client: Preview element not found, falling back to text upload");
        await uploadMarkdownAsDoc(baseFileName, minutes, targetFolderId, accessToken);
      }

      // 5. 録音音声データがある場合は保存
      if (recorder.audioBlob) {
        console.log("Client: Uploading recorded audio...");
        const audioBlob = new Blob([recorder.audioBlob], { type: "audio/mp4" });
        await uploadAudioFile(`${baseFileName}.m4a`, audioBlob, audioRootFolderId, accessToken);
      }

      // 6. アップロードされた付随音声ファイルがある場合も保存
      const uploadedAudioFiles = files.filter(f => f.type === "audio");
      if (uploadedAudioFiles.length > 0) {
        console.log(`Client: Uploading ${uploadedAudioFiles.length} uploaded audio files...`);
        for (let i = 0; i < uploadedAudioFiles.length; i++) {
          const f = uploadedAudioFiles[i];
          const suffix = uploadedAudioFiles.length > 1 ? `_${i + 1}` : "";
          const fileExt = f.name.split('.').pop();
          const fileName = `${baseFileName}${suffix}.${fileExt}`;
          await uploadAudioFile(fileName, f.file, audioRootFolderId, accessToken);
        }
      }

      // 7. 保存成功
      setIsSaved(true);
      alert(`✓ Google Driveに保存しました\nフォルダ: ${dateFolderName}`);
    } catch (err: any) {
      console.error("Client Save error details:", err);
      let msg = err instanceof Error ? err.message : "保存に失敗しました";
      setError(msg);

      // 録音時のみダウンロード案内を出す
      const downloadHint = recorder.audioBlob
        ? "\n\n※ 通信エラーや容量オーバーの場合は、右下の「⬇️ 音声ダウンロード」ボタンから録音ファイルを保存してください。"
        : "\n\n※ 通信エラーやGoogleドライブの容量不足の可能性があります。";

      // 認証エラー（セッション切れ・権限不足など）を検知して再ログインを促す
      const isAuthError = msg.toLowerCase().includes("auth") ||
        msg.toLowerCase().includes("permission") ||
        msg.toLowerCase().includes("token") ||
        msg.toLowerCase().includes("credentials") ||
        msg.includes("Failed to fetch"); // fetch自体の失敗(cors/401等)も含む

      if (isAuthError) {
        const shouldReAuth = window.confirm(
          `❌ ドライブへの保存に失敗しました（認証エラー）\n\nセッションが切れているため、再度Googleログインが必要です。\n\n⚠️ 【重要】録音データについて\n再ログインを実行すると、ページがリロードされ「録音された元の音声ファイル」は失われます。\n\n音声を残しておきたい場合は、ここで「キャンセル」を押し、画面の「⬇️ 音声ダウンロード」ボタンから手元に保存した上で、再度保存ボタンを押してログインに進んでください。\n\n「OK」を押すと、現在の議事録テキストのみを一時保存してログイン画面を開きます。`
        );
        if (shouldReAuth) {
          handleReAuth();
          return;
        }
      } else {
        alert(`❌ ドライブへの保存に失敗しました\n内容: ${msg}${downloadHint}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  // セッション切れ時の再認証フロー（データ退避付き）
  const handleReAuth = () => {
    try {
      // 必要なステートを sessionStorage に退避
      const backupData = {
        minutes,
        transcript,
        participants: confirmedParticipants,
        mode,
        timestamp: Date.now()
      };
      sessionStorage.setItem("quickMinutesBackup", JSON.stringify(backupData));

      // Googleログインへ遷移（現在のURLに戻ってくる）
      signIn("google", { callbackUrl: window.location.href });
    } catch (err) {
      console.error("Backup failed:", err);
      alert("データの退避に失敗しました。お手数ですが、テキストをコピーして手動でバックアップしてください。");
    }
  };

  // Handle email sending
  const handleSendEmail = async () => {
    const to = prompt("送信先のメールアドレスを入力してください：");
    if (!to) return;

    setIsSendingEmail(true);
    setError(null);

    try {
      // 日付フォーマット (YYYYMMDD)
      const now = new Date();
      const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      const yyyymmdd = jstNow.toISOString().split("T")[0].replace(/-/g, "");

      // ファイル名生成（Drive保存と同じルール）
      let meetingIdentifier: string;
      if (selectedPreset?.name) {
        meetingIdentifier = selectedPreset.name;
      } else {
        meetingIdentifier = confirmedParticipants.length > 0
          ? confirmedParticipants.map(p => p.name).join("_")
          : "会議";
      }

      const subject = `[INAHO AI] 本日の議事録_${yyyymmdd}`;
      const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', sans-serif; color: #333; line-height: 1.8;">
  <p style="color: #888; font-size: 13px; margin-bottom: 16px;">（AIによる自動送信）</p>
  <p>本日はありがとうございました。</p>
  <p>打合せの内容を解析し、ネクストアクションと決定事項をPDFに集約しています。<br>
  添付のファイルをご確認ください。</p>
  <div style="color: #999; font-size: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee;">
    <p style="margin: 0; font-style: italic;">-思考の鮮度が落ちないうちに、次の一歩へ繋げる</p>
    <p style="margin: 4px 0 0 0; font-size: 11px;">Generated by INAHO Quick Minutes v2 (Gemini-3.0-Flash) -</p>
  </div>
</body>
</html>`;

      // PDFを生成
      const html2pdf = (await import("html2pdf.js")).default;
      const previewElement = document.querySelector('[data-minutes-preview]');

      if (!previewElement) {
        throw new Error("議事録のプレビュー要素が見つかりません");
      }

      // 親コンテナのスタイルとスクロール位置を一時的にリセット（空白ページ防止）
      const contentContainer = previewElement.parentElement as HTMLElement;
      const originalContainerStyle = contentContainer?.getAttribute('style') || '';
      const originalScrollTop = contentContainer?.scrollTop || 0;
      if (contentContainer) {
        contentContainer.scrollTop = 0;
        contentContainer.style.maxHeight = 'none';
        contentContainer.style.overflow = 'visible';
      }

      // PDF生成用の一時スタイルを適用
      const originalStyle = (previewElement as HTMLElement).getAttribute('style') || '';
      (previewElement as HTMLElement).style.cssText = `
        background: white !important;
        color: #333 !important;
        padding: 20px !important;
        font-size: 12pt !important;
        line-height: 1.6 !important;
        overflow: visible !important;
        max-width: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
      `;

      // テーブルや見出しのスタイルも調整（Drive保存と同じスタイル）
      const emailStyleSheet = document.createElement('style');
      emailStyleSheet.id = 'pdf-email-print-styles';
      emailStyleSheet.textContent = `
        [data-minutes-preview] * { color: #333 !important; }
        [data-minutes-preview] > *:first-child {
          margin-top: 0 !important;
        }
        [data-minutes-preview] h1, [data-minutes-preview] h2, [data-minutes-preview] h3 { 
          color: #111 !important; 
          border-bottom: 1px solid #ccc !important; 
          padding-bottom: 0.5rem !important;
        }
        [data-minutes-preview] table { 
          border: 1px solid #ddd !important; 
          background: #fafafa !important;
          width: 100% !important;
          max-width: 100% !important;
          table-layout: auto !important;
        }
        [data-minutes-preview] th { 
          background: #e8e8e8 !important; 
          color: #111 !important;
          font-weight: bold !important;
          white-space: nowrap !important;
        }
        [data-minutes-preview] td, [data-minutes-preview] th { 
          border: 1px solid #ddd !important; 
          padding: 6px 8px !important;
          word-wrap: break-word !important;
          overflow-wrap: break-word !important;
          font-size: 9pt !important;
          vertical-align: top !important;
        }
        [data-minutes-preview] td:first-child,
        [data-minutes-preview] th:first-child {
          white-space: nowrap !important;
        }
        [data-minutes-preview] td:nth-child(2),
        [data-minutes-preview] th:nth-child(2) {
          white-space: nowrap !important;
          text-align: center !important;
        }
        [data-minutes-preview] td:last-child,
        [data-minutes-preview] th:last-child {
          word-break: break-word !important;
        }
        [data-minutes-preview] strong { color: #111 !important; }
      `;
      document.head.appendChild(emailStyleSheet);

      const pdfOptions = {
        margin: [10, 15, 10, 15] as [number, number, number, number],
        filename: `${yyyymmdd}-${meetingIdentifier}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          backgroundColor: '#ffffff',
          windowWidth: document.documentElement.offsetWidth,
          scrollY: 0
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait' as const
        }
      };

      const pdfBlob = await html2pdf()
        .set(pdfOptions)
        .from(previewElement as HTMLElement)
        .outputPdf('blob');

      // スタイルを戻す
      (previewElement as HTMLElement).setAttribute('style', originalStyle);
      document.getElementById('pdf-email-print-styles')?.remove();

      // 親コンテナのスタイルとスクロール位置を復元
      if (contentContainer) {
        contentContainer.setAttribute('style', originalContainerStyle);
        contentContainer.scrollTop = originalScrollTop;
      }

      // PDFをBase64に変換
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(",")[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(pdfBlob);
      });

      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject,
          content: htmlContent,
          attachment: {
            filename: `${yyyymmdd}-${meetingIdentifier}.pdf`,
            mimeType: "application/pdf",
            data: pdfBase64,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "メールの送信に失敗しました");
      }

      alert("✓ メールを送信しました");

    } catch (err) {
      setError(err instanceof Error ? err.message : "メール送信に失敗しました");
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Handle audio download
  const handleDownloadAudio = () => {
    if (!recorder.audioBlob) return;

    const topic = extractTopic(minutes);
    const now = new Date();
    const jstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const yyyymmdd = jstNow.toISOString().split("T")[0].replace(/-/g, "");

    // 拡張子を強制的に .m4a にする
    const fileName = `${yyyymmdd}_録音_${topic || "会議"}.m4a`;

    // ダウンロード用にMIMEタイプを明示したBlobを再生成
    const audioFile = new Blob([recorder.audioBlob], { type: "audio/mp4" });
    const url = URL.createObjectURL(audioFile);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Reset to initial state
  const handleReset = () => {
    setAppState("idle");
    setTranscript("");
    setMinutes("");
    setFiles([]);
    setError(null);
    setIsSaved(false);
    recorder.resetRecording();
  };

  // Cancel recording with confirmation
  const handleCancelRecording = () => {
    const confirmed = window.confirm(
      "録音をキャンセルしますか？\n\n※ 録音データは失われます。"
    );
    if (confirmed) {
      recorder.stopRecording();
      recorder.resetRecording();
      setAppState("idle");
    }
  };

  // Extract topic from minutes
  const extractTopic = (text: string): string => {
    const match = text.match(/^#{1,3}\s*(.+)$/m);
    if (!match) return "会議";
    return match[1]
      .replace("議事録", "")
      .replace(/^[\d]+\.\s*/, "")  // 先頭番号 ("1. ") を除去
      .trim();
  };

  // Loading state
  if (status === "loading") {
    return (
      <main className={styles.main}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>読み込み中...</p>
        </div>
      </main>
    );
  }

  // Login required
  if (!session) {
    return (
      <main className={styles.main}>
        <div className={styles.loginContainer}>
          <div className={styles.logo}>
            <img src="/inaho-logo.png?v=4" alt="INAHO" width={180} height={40} className={styles.logoImage} style={{ objectFit: 'contain' }} />
            <h1>議事録</h1>
          </div>
          <p className={styles.tagline}>
            AIが議事録を自動生成
          </p>
          <div className={styles.versionBadge}>{APP_VERSION}</div>
          <LoginButton />
        </div>
      </main>
    );
  }

  // Access check in progress
  if (accessCheckState === "checking") {
    return (
      <main className={styles.main}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <p>アクセス権を確認中...</p>
        </div>
      </main>
    );
  }

  // Access denied
  if (accessCheckState === "denied") {
    return (
      <main className={styles.main}>
        <div className={styles.loginContainer}>
          <div className={styles.logo}>
            <img src="/inaho-logo.png?v=4" alt="INAHO" width={180} height={40} className={styles.logoImage} style={{ objectFit: 'contain' }} />
            <h1>議事録</h1>
          </div>
          <div className={styles.accessDenied}>
            <p className={styles.accessDeniedIcon}>🔒</p>
            <p className={styles.accessDeniedTitle}>アクセス権が必要です</p>
            <p className={styles.accessDeniedMessage}>
              {accessError?.message || "共有フォルダへのアクセス権がありません"}
            </p>
            <p className={styles.accessDeniedHint}>
              このアプリを使用するには、組織の共有フォルダへのアクセス権が必要です。
              <br />
              管理者に連絡してアクセス権をリクエストしてください。
            </p>
            {accessError?.requestUrl && (
              <a
                href={accessError.requestUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.requestAccessButton}
              >
                📁 共有フォルダを開いてアクセス権をリクエスト
              </a>
            )}
            <LoginButton />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <img src="/inaho-logo.png?v=4" alt="INAHO" className={styles.headerLogo} />
          <span className={styles.headerDivider} />
          <div className={styles.headerTitleGroup}>
            <span className={styles.headerAppName}>議事録</span>
            <span className={styles.headerVersion}>{APP_VERSION}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.settingsButton}
            onClick={() => {
              if (appState === "recording" || appState === "confirming" || appState === "introduction" || appState === "uploading" || appState === "processing") {
                alert("処理中は操作できません");
                return;
              }
              if (appState === "editing" && !isSaved) {
                const confirmed = window.confirm("議事録が保存されていません。\n設定画面に移動してもよろしいですか？");
                if (!confirmed) return;
              }
              window.location.href = "/settings";
            }}
            title="プロンプト設定"
          >
            ⚙️ 設定
          </button>
          <LoginButton
            isRecording={appState === "recording" || appState === "confirming" || appState === "introduction" || appState === "uploading" || appState === "processing"}
            isEditing={appState === "editing"}
            isSaved={isSaved}
          />
        </div>
      </header>

      {/* iOS PWA Warning */}
      {isPwaMode && (
        <div className={styles.iosWarning}>
          📱 ホーム画面に追加した状態ではバックグラウンド録音ができません。<br />
          通常のブラウザ（SafariやChrome）のタブから開いてご利用ください。
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className={styles.error}>
          ⚠️ {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Main Content */}
      <div className={styles.content}>
        {appState === "idle" && (
          <div className={styles.homeScreen}>
            {/* Record Button */}
            <RecordButton
              isRecording={false}
              isPaused={false}
              isInterrupted={false}
              duration={0}
              onStart={handleStartRecording}
              onStop={() => { }}
              onPause={() => { }}
              onResume={() => { }}
              onResumeInterrupted={() => { }}
            />

            {/* Mode Selector */}
            <ModeSelector
              selectedMode={mode}
              onModeChange={setMode}
              selectedPreset={selectedPreset}
              onPresetChange={(preset) => {
                setSelectedPreset(preset);
                if (preset?.duration) {
                  setSelectedDuration(preset.duration);
                }
              }}
            />

            {/* Timer Selector */}
            <TimerSelector
              selected={selectedDuration}
              onChange={setSelectedDuration}
              disabled={!!selectedPreset}
            />

            {/* Input Section Header */}
            <div className={styles.inputSectionHeader}>
              <p>録音以外の方法で議事録を作成する場合は、<br />下記にファイルまたは文字起こしを入力してください</p>
            </div>

            {/* File Upload */}
            <div className={styles.uploadSection}>
              <FileUpload files={files} onFilesChange={setFiles} />
            </div>

            {/* Transcript Input */}
            <TranscriptInput
              value={transcript}
              onChange={setTranscript}
            />

            {/* Generate Button (always visible) */}
            <button
              className={`${styles.generateButton} ${(!transcript && files.length === 0) ? styles.generateButtonDisabled : ''}`}
              onClick={handleGenerateFromInput}
              disabled={!transcript && files.length === 0}
            >
              ✨ 議事録を生成
            </button>
          </div>
        )}

        {appState === "confirming" && (
          <ParticipantConfirmation
            preset={selectedPreset}
            onConfirm={handleParticipantConfirm}
            onCancel={handleParticipantCancel}
          />
        )}

        {appState === "uploadConfirming" && (
          <ParticipantConfirmation
            preset={selectedPreset}
            onConfirm={handleUploadParticipantConfirm}
            onCancel={() => setAppState("idle")}
            isUploadMode={true}
          />
        )}

        {appState === "introduction" && (
          <IntroductionScreen
            duration={recorder.duration}
            countdownFrom={selectedDuration > 0 ? selectedDuration * 60 : undefined}
            onComplete={handleIntroductionComplete}
            onSkip={handleIntroductionSkip}
            existingParticipants={confirmedParticipants}
          />
        )}

        {appState === "recording" && (
          <>
            <div className={styles.recordingScreen}>
              <RecordButton
                isRecording={recorder.isRecording}
                isPaused={recorder.isPaused}
                isInterrupted={recorder.isInterrupted}
                duration={recorder.duration}
                countdownFrom={selectedDuration > 0 ? selectedDuration * 60 : undefined}
                onStart={handleStartRecording}
                onStop={handleStopRecording}
                onPause={recorder.pauseRecording}
                onResume={recorder.resumeRecording}
                onResumeInterrupted={recorder.resumeInterrupted}
                onCancel={handleCancelRecording}
                onTimeUp={handleTimeUp}
                additionalPrompt={additionalPrompt}
                onAdditionalPromptChange={setAdditionalPrompt}
              />

              <ModeSelector
                selectedMode={mode}
                onModeChange={setMode}
                selectedPreset={selectedPreset}
                onPresetChange={setSelectedPreset}
                readOnly
                compact
              />

              {/* 録音中の資料アップロード（音声ファイル以外） */}
              <FileUpload
                files={files}
                onFilesChange={setFiles}
                acceptTypes="application/pdf,image/*,.txt"
                compact={true}
                compactLabel="資料を追加"
              />

              {/* メモ入力 */}
              <div className={styles.meetingNotesSection}>
                <button
                  className={`${styles.notesToggle} ${isNotesOpen ? styles.notesToggleOpen : ''}`}
                  onClick={() => setIsNotesOpen(!isNotesOpen)}
                >
                  <span>📌 メモを追加</span>
                  <span className={styles.notesToggleArrow}>{isNotesOpen ? '▲' : '▼'}</span>
                </button>
                {isNotesOpen && (
                  <textarea
                    className={styles.notesInput}
                    value={meetingNotes}
                    onChange={(e) => setMeetingNotes(e.target.value)}
                    placeholder="例: ○○株式会社は○○業の会社 / ○○は最近開発した新アプリのこと"
                    rows={3}
                  />
                )}
              </div>
            </div>

            {/* Floating participant edit button */}
            <ParticipantEditButton
              onClick={() => setShowParticipantEdit(true)}
              participantCount={confirmedParticipants.length}
            />

            {/* Floating participant edit modal */}
            {showParticipantEdit && (
              <div style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.8)",
                zIndex: 1000,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "1rem"
              }}>
                <div style={{
                  background: "#1a1a2e",
                  borderRadius: "16px",
                  maxWidth: "450px",
                  width: "100%",
                  maxHeight: "90vh",
                  overflow: "auto"
                }}>
                  <ParticipantConfirmation
                    isFloating={true}
                    currentParticipants={confirmedParticipants}
                    onUpdate={setConfirmedParticipants}
                    onClose={() => setShowParticipantEdit(false)}
                    onConfirm={() => { }}
                    onCancel={() => { }}
                  />
                </div>
              </div>
            )}

            {/* Timer End Modal */}
            {showTimerEndModal && (
              <TimerEndModal
                onEnd={handleTimerEnd}
                onExtend={handleTimerExtend}
                onExtendWithBreak={handleTimerExtendWithBreak}
              />
            )}
          </>
        )}

        {appState === "uploading" && (
          <div className={styles.processingScreen}>
            <div className={styles.spinner} />
            <p>{uploadProgress || "ファイルを読み込み中..."}</p>
            <p className={styles.processingHint}>
              大きなファイルの場合は時間がかかることがあります。<br />
              Vercelの制限を回避するため、直接Geminiに送信しています。
            </p>
          </div>
        )}

        {appState === "processing" && (
          <ProcessingScreen
            audioBlob={recorder.audioBlob}
            error={error}
            onCancel={() => {
              setAppState("idle");
              setError(null);
            }}
            onRetry={() => {
              setError(null);
              // 参加者を保持したまま再生成
              if (lastGenerationParams) {
                generateMinutes(
                  recorder.audioBlob || undefined,
                  confirmedParticipants.length > 0 ? confirmedParticipants : undefined
                );
              } else {
                setAppState("idle");
                setError("リトライに必要なデータがありません。もう一度やり直してください。");
              }
            }}
          />
        )}

        {appState === "editing" && (
          <div className={styles.editingScreen}>
            <MinutesEditor
              content={minutes}
              mode={mode}
              onChange={setMinutes}
              onSave={handleSave}
              onRegenerate={lastGenerationParams ? handleRegenerate : undefined}
              onDownloadAudio={recorder.audioBlob ? handleDownloadAudio : undefined}
              onEditingChange={setIsMinutesEditing}
              isSaving={isSaving}
              isSaved={isSaved}
              isRegenerating={isRegenerating}
              isSendingEmail={isSendingEmail}
              modelVersion={modelVersion}
              isTrialMode={isTrialDeployment}
              isPdfReady={isPdfReady}
            />

            <div className={styles.secondaryActions}>
              <button
                className={`${styles.emailButton} ${isTrialDeployment ? styles.emailButtonDisabled : ''}`}
                onClick={isTrialDeployment ? undefined : handleSendEmail}
                disabled={isTrialDeployment || !minutes || isSaving || isSendingEmail}
                title={isTrialDeployment ? "モニター版では現在利用できません" : undefined}
              >
                {isSendingEmail ? "送信中..." : isTrialDeployment ? "📧 メールで送信（準備中）" : "📧 メールで送信"}
              </button>
            </div>

            <button
              className={styles.newButton}
              onClick={() => {
                if (!isSaved) {
                  const msg = isTrialDeployment
                    ? "議事録がPDFに保存されていません。\n\nトップに戻ってもよろしいですか？"
                    : "議事録がGoogle Driveに保存されていません。\n\nトップに戻ってもよろしいですか？";
                  const confirmed = window.confirm(msg);
                  if (!confirmed) return;
                }
                handleReset();
              }}
            >
              トップに戻る
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
