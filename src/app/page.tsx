"use client";

import { useState, useCallback, useEffect } from "react";
import { useSession } from "next-auth/react";
import { MeetingMode, UploadedFile } from "@/types";
import { useAudioRecorder, blobToBase64 } from "@/hooks/useAudioRecorder";

import LoginButton from "@/components/LoginButton";
import RecordButton from "@/components/RecordButton";
import ModeSelector from "@/components/ModeSelector";
import FileUpload from "@/components/FileUpload";
import TranscriptInput from "@/components/TranscriptInput";
import MinutesEditor from "@/components/MinutesEditor";
import styles from "./page.module.css";
import { uploadToGemini } from "@/lib/gemini-client";
import { findFolderByName, createFolder, uploadMarkdownAsDoc, uploadAudioFile } from "@/lib/drive-client";

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

type AppState = "idle" | "recording" | "uploading" | "processing" | "editing";

export default function Home() {
  const { data: session, status } = useSession();

  // App state
  const [appState, setAppState] = useState<AppState>("idle");
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const [mode, setMode] = useState<MeetingMode>("internal");
  const [transcript, setTranscript] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [minutes, setMinutes] = useState("");
  const [modelVersion, setModelVersion] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPwaMode, setIsPwaMode] = useState(false);

  // Audio recorder
  const recorder = useAudioRecorder();

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

  // Handle recording start
  const handleStartRecording = useCallback(async () => {
    setError(null);
    await recorder.startRecording();
    setAppState("recording");
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
      setError(err instanceof Error ? err.message : "エラーが発生しました");
      setAppState("idle");
    }
  };

  // Handle generate from transcript or files
  const handleGenerateFromInput = () => {
    if (!transcript.trim() && files.length === 0) {
      setError("文字起こしテキストを入力するか、ファイルをアップロードしてください");
      return;
    }
    generateMinutes();
  };

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

      // 4. 議事録を保存 (Google Docとして)
      console.log("Client: Uploading minutes doc...");
      await uploadMarkdownAsDoc(`${baseFileName}_議事録`, minutes, targetFolderId, accessToken);

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

      const response = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject,
          content: minutes,
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
            <span className={styles.logoIcon}>📝</span>
            <h1>INAHO議事録</h1>
          </div>
          <p className={styles.tagline}>
            AIが議事録を自動生成
          </p>
          <LoginButton />
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logoSmall}>📝</span>
          <span className={styles.appName}>INAHO議事録</span>
        </div>
        <div className={styles.headerRight}>
          <button
            className={styles.settingsButton}
            onClick={() => window.location.href = "/settings"}
            title="プロンプト設定"
          >
            ⚙️ 設定
          </button>
          <LoginButton />
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
            <ModeSelector selectedMode={mode} onModeChange={setMode} />

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

        {appState === "recording" && (
          <div className={styles.recordingScreen}>
            <RecordButton
              isRecording={recorder.isRecording}
              isPaused={recorder.isPaused}
              isInterrupted={recorder.isInterrupted}
              duration={recorder.duration}
              onStart={handleStartRecording}
              onStop={handleStopRecording}
              onPause={recorder.pauseRecording}
              onResume={recorder.resumeRecording}
              onResumeInterrupted={recorder.resumeInterrupted}
              onCancel={handleCancelRecording}
            />

            <ModeSelector selectedMode={mode} onModeChange={setMode} />
          </div>
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
          <div className={styles.processingScreen}>
            <div className={styles.processingCircle} />

            <div className={styles.messageContainer}>
              <h2 className={styles.mainMessage}>会議、お疲れ様でした！</h2>
              <p className={styles.subMessage}>
                価値ある対話を、確かな資産に変えています...
              </p>
            </div>

            <p className={styles.processingHint}>
              AIが重要な意思決定と、次のアクションを精緻に抽出しています。まもなくスマートな議事録が完成します。
            </p>
          </div>
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
