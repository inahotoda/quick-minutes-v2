"use client";

import { useState, useCallback, useEffect } from "react";
import { useSession } from "next-auth/react";
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

const APP_VERSION = "v4.13.0";
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

  // Access check state
  const [accessCheckState, setAccessCheckState] = useState<"checking" | "granted" | "denied">("checking");
  const [accessError, setAccessError] = useState<{ message: string; requestUrl?: string } | null>(null);

  // Audio recorder
  const recorder = useAudioRecorder();

  // Check folder access after login (only once)
  useEffect(() => {
    // ログイン済みで、まだアクセス権が確認されていない場合のみチェック
    if (session && status === "authenticated" && accessCheckState === "checking") {
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
  }, [session, status, accessCheckState]);

  // Browser detection
  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isStandalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;

    // iOSかつPWAモード（ホーム画面から起動）の場合に警告を出す
    if (isIos && isStandalone) {
      setIsPwaMode(true);
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
  const generateMinutes = async (audioBlob?: Blob) => {
    setAppState("uploading");
    setUploadProgress("Geminiにファイルをアップロード中...");
    setError(null);

    try {
      const requestBody: Record<string, unknown> = {
        mode,
        date: new Date().toLocaleDateString("ja-JP"),
        participants: confirmedParticipants.map(p => p.name), // 参加者名をGeminiに送信
      };

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
      const errorMessage = err instanceof Error ? err.message : "エラーが発生しました";
      setError(errorMessage);
      setAppState("idle");

      // 音声データのバックアップ: 議事録生成が失敗しても録音データを守る
      if (recorder.audioBlob) {
        const shouldDownload = window.confirm(
          `❌ 議事録の生成に失敗しました\n\nエラー: ${errorMessage}\n\n❗ 大切な録音データを保護するため、音声ファイルをダウンロードしますか？`
        );
        if (shouldDownload) {
          const url = URL.createObjectURL(recorder.audioBlob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `会議録音_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.m4a`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      }
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
    generateMinutes();
  }, [transcript, files, mode]);

  // Handle save to Google Drive - Direct client upload to bypass Vercel limits
  const handleSave = async () => {
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
      const modeLabel = mode === "business" ? "商談" : mode === "internal" ? "社内" : "その他";
      const userName = session.user?.name || "不明";
      const baseFileName = `${yyyymmdd}_${modeLabel}_${topic || "会議"}(${userName})`;

      // 4. 議事録をPDFとして保存
      console.log("Client: Generating PDF from minutes...");

      // html2pdfをdynamic importで読み込む
      const html2pdf = (await import("html2pdf.js")).default;

      // 議事録プレビュー要素を取得（MinutesEditorのプレビュー部分）
      const previewElement = document.querySelector('[data-minutes-preview]');

      if (previewElement) {
        // PDF生成用の一時スタイルを適用（白背景・黒文字）
        const originalStyle = (previewElement as HTMLElement).getAttribute('style') || '';
        (previewElement as HTMLElement).style.cssText = `
          background: white !important;
          color: #333 !important;
          padding: 20px !important;
          font-size: 12pt !important;
          line-height: 1.6 !important;
        `;

        // テーブルや見出しのスタイルも調整
        const styleSheet = document.createElement('style');
        styleSheet.id = 'pdf-print-styles';
        styleSheet.textContent = `
          [data-minutes-preview] * { color: #333 !important; }
          [data-minutes-preview] h1, [data-minutes-preview] h2, [data-minutes-preview] h3 { 
            color: #111 !important; 
            border-bottom: 1px solid #ccc !important; 
            padding-bottom: 0.5rem !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          [data-minutes-preview] table { 
            border: 1px solid #ddd !important; 
            background: #fafafa !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          [data-minutes-preview] tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          [data-minutes-preview] th { 
            background: #e8e8e8 !important; 
            color: #111 !important;
            font-weight: bold !important;
          }
          [data-minutes-preview] td, [data-minutes-preview] th { 
            border: 1px solid #ddd !important; 
            padding: 8px !important;
          }
          [data-minutes-preview] strong { color: #111 !important; }
          [data-minutes-preview] p {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            orphans: 3 !important;
            widows: 3 !important;
          }
          [data-minutes-preview] li {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          [data-minutes-preview] ul, [data-minutes-preview] ol {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          [data-minutes-preview] blockquote {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        `;
        document.head.appendChild(styleSheet);

        // PDF生成オプション
        const pdfOptions = {
          margin: [10, 15, 10, 15] as [number, number, number, number],
          filename: `${baseFileName}_議事録.pdf`,
          image: { type: 'jpeg' as const, quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            letterRendering: true,
            backgroundColor: '#ffffff'
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

        // PDFを生成してBlobとして取得
        const pdfBlob = await html2pdf()
          .set(pdfOptions)
          .from(previewElement as HTMLElement)
          .outputPdf('blob');

        // 一時スタイルを元に戻す
        (previewElement as HTMLElement).setAttribute('style', originalStyle);
        document.getElementById('pdf-print-styles')?.remove();

        console.log("Client: PDF generated, size:", pdfBlob.size, "bytes");

        // Google Driveにアップロード
        await uploadPdfFile(`${baseFileName}_議事録.pdf`, pdfBlob, targetFolderId, accessToken);
        console.log("Client: PDF uploaded to Drive");
      } else {
        // プレビュー要素が見つからない場合はテキストとして保存
        console.warn("Client: Preview element not found, falling back to text upload");
        await uploadMarkdownAsDoc(`${baseFileName}_議事録`, minutes, targetFolderId, accessToken);
      }

      // 5. 録音音声データがある場合は保存
      if (recorder.audioBlob) {
        console.log("Client: Uploading recorded audio...");
        const audioBlob = new Blob([recorder.audioBlob], { type: "audio/mp4" });
        await uploadAudioFile(`${baseFileName}_音声.m4a`, audioBlob, audioRootFolderId, accessToken);
      }

      // 6. アップロードされた付随音声ファイルがある場合も保存
      const uploadedAudioFiles = files.filter(f => f.type === "audio");
      if (uploadedAudioFiles.length > 0) {
        console.log(`Client: Uploading ${uploadedAudioFiles.length} uploaded audio files...`);
        for (let i = 0; i < uploadedAudioFiles.length; i++) {
          const f = uploadedAudioFiles[i];
          const suffix = uploadedAudioFiles.length > 1 ? `_${i + 1}` : "";
          const fileExt = f.name.split('.').pop();
          const fileName = `${baseFileName}_音声${suffix}.${fileExt}`;
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

      alert(`❌ ドライブへの保存に失敗しました\n内容: ${msg}${downloadHint}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle email sending
  const handleSendEmail = async () => {
    const to = prompt("送信先のメールアドレスを入力してください：");
    if (!to) return;

    setIsSendingEmail(true);
    setError(null);

    try {
      const topic = extractTopic(minutes);
      const subject = `【議事録】${topic || "会議"}`;
      const plainContent = stripMarkdown(minutes);

      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject,
          content: plainContent,
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
    const match = text.match(/^#\s*(.+)$/m);
    return match ? match[1].replace("議事録", "").trim() : "会議";
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
            <img src="/inaho-logo.png" alt="INAHO" width={120} height={128} className={styles.logoImage} />
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
            <img src="/inaho-logo.png" alt="INAHO" width={120} height={128} className={styles.logoImage} />
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
        <div className={styles.headerLeft}>
          <img src="/inaho-logo.png" alt="INAHO" width={28} height={30} className={styles.headerLogoImage} />
          <span className={styles.appName}>議事録</span>
          <span className={styles.headerVersionBadge}>{APP_VERSION}</span>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.settingsButton}
            onClick={() => {
              if (appState === "recording" || appState === "confirming" || appState === "introduction") {
                alert("録音中は操作できません");
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
            isRecording={appState === "recording" || appState === "confirming" || appState === "introduction"}
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
              />

              <ModeSelector
                selectedMode={mode}
                onModeChange={setMode}
                selectedPreset={selectedPreset}
                onPresetChange={setSelectedPreset}
              />

              {/* 録音中の資料アップロード（音声ファイル以外） */}
              <FileUpload
                files={files}
                onFilesChange={setFiles}
                acceptTypes="application/pdf,image/*,.txt"
                compact={true}
                compactLabel="資料を追加"
              />
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
            onCancel={() => {
              setAppState("idle");
              setError(null);
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
              onDownloadAudio={recorder.audioBlob ? handleDownloadAudio : undefined}
              isSaving={isSaving}
              isSendingEmail={isSendingEmail}
              modelVersion={modelVersion}
            />

            <div className={styles.secondaryActions}>
              <button
                className={styles.emailButton}
                onClick={handleSendEmail}
                disabled={!minutes || isSaving || isSendingEmail}
              >
                {isSendingEmail ? "送信中..." : "📧 メールで送信"}
              </button>
            </div>

            <button
              className={styles.newButton}
              onClick={handleReset}
            >
              トップに戻る
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
