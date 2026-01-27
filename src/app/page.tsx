"use client";

import { useState, useCallback } from "react";
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
  const [mode, setMode] = useState<MeetingMode>("internal");
  const [transcript, setTranscript] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [minutes, setMinutes] = useState("");
  const [modelVersion, setModelVersion] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Audio recorder
  const recorder = useAudioRecorder();

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
    setError(null);

    try {
      const requestBody: Record<string, unknown> = {
        mode,
        date: new Date().toLocaleDateString("ja-JP"),
      };

      // Handle live recording audio
      if (audioBlob) {
        const audioBase64 = await blobToBase64(audioBlob);
        requestBody.audioBase64 = audioBase64;
        requestBody.audioMimeType = audioBlob.type;
      }

      // Handle transcript text input
      if (transcript) {
        requestBody.transcript = transcript;
      }

      // Handle uploaded files
      if (files.length > 0) {
        const uploadedFiles = await Promise.all(
          files.map(async (f) => ({
            name: f.name,
            type: f.type,
            mimeType: f.file.type,
            base64: await fileToBase64(f.file),
          }))
        );
        requestBody.uploadedFiles = uploadedFiles;
      }

      // Check if we have any input
      if (!audioBlob && !transcript && files.length === 0) {
        setError("録音データ、文字起こしテキスト、またはファイルが必要です");
        setAppState("idle");
        return;
      }

      setAppState("processing");

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

  // Handle save to Google Drive
  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const topic = extractTopic(minutes);

      const response = await fetch("/api/drive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          minutes,
          mode,
          audioBlob: recorder.audioBlob ? await blobToBase64(recorder.audioBlob) : null,
          audioMimeType: recorder.audioBlob?.type || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "保存に失敗しました");
      }

      alert(`✓ Google Driveに保存しました\nフォルダ: ${data.folderName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setIsSaving(false);
    }
  };

  // Handle email sending
  const handleSendEmail = async () => {
    const to = prompt("送信先のメールアドレスを入力してください：");
    if (!to) return;

    setIsSaving(true);
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
      setIsSaving(false);
    }
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
              duration={0}
              onStart={handleStartRecording}
              onStop={() => { }}
              onPause={() => { }}
              onResume={() => { }}
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
              duration={recorder.duration}
              onStart={handleStartRecording}
              onStop={handleStopRecording}
              onPause={recorder.pauseRecording}
              onResume={recorder.resumeRecording}
              onCancel={handleCancelRecording}
            />

            <ModeSelector selectedMode={mode} onModeChange={setMode} />
          </div>
        )}

        {appState === "uploading" && (
          <div className={styles.processingScreen}>
            <div className={styles.spinner} />
            <p>ファイルを読み込み中...</p>
            <p className={styles.processingHint}>
              大きなファイルの場合は時間がかかることがあります
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
              isSaving={isSaving}
              modelVersion={modelVersion}
            />

            <div className={styles.secondaryActions}>
              <button
                className={styles.emailButton}
                onClick={handleSendEmail}
                disabled={!minutes || isSaving}
              >
                📧 メールで送信
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
