"use client";

import { useRef, useState } from "react";
import { UploadedFile } from "@/types";
import styles from "./FileUpload.module.css";

interface FileUploadProps {
    files: UploadedFile[];
    onFilesChange: (files: UploadedFile[]) => void;
    acceptTypes?: string;
    compact?: boolean;
    compactLabel?: string;
}

export default function FileUpload({
    files,
    onFilesChange,
    acceptTypes = "audio/*,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/webm,.mp3,.m4a,.aac,.wav,.ogg,.webm,.mp4,application/pdf,image/*,.txt",
    compact = false,
    compactLabel = "資料を追加",
}: FileUploadProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragActive, setDragActive] = useState(false);
    const isAudioOnly = acceptTypes.startsWith("audio/") && !acceptTypes.includes("pdf") && !acceptTypes.includes("image");
    const isPdfImageOnly = !acceptTypes.includes("audio") && (acceptTypes.includes("pdf") || acceptTypes.includes("image"));

    const handleFileSelect = (selectedFiles: FileList | null) => {
        if (!selectedFiles) return;

        const audioExtensions = [".mp3", ".m4a", ".aac", ".wav", ".ogg", ".webm", ".mp4", ".flac", ".opus"];

        const newFiles: UploadedFile[] = [];

        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            let type: UploadedFile["type"] = "image";

            // 拡張子も含めて音声ファイルかどうか判定
            // (.m4a.webm のような二重拡張子や、video/webm として検出されるケースに対応)
            const fileName = file.name.toLowerCase();
            const isAudioByExtension = audioExtensions.some(ext => fileName.endsWith(ext));
            const isAudioByMime = file.type.startsWith("audio/") || file.type.startsWith("video/");

            if (isAudioByMime || isAudioByExtension) {
                type = "audio";
            } else if (file.type === "application/pdf" || file.type === "text/plain") {
                type = "pdf";
            }

            newFiles.push({
                id: `${Date.now()}-${i}`,
                name: file.name,
                type,
                file,
            });
        }

        onFilesChange([...files, ...newFiles]);
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        handleFileSelect(e.dataTransfer.files);
    };

    const removeFile = (id: string) => {
        onFilesChange(files.filter((f) => f.id !== id));
    };

    const getFileIcon = (type: UploadedFile["type"]) => {
        switch (type) {
            case "audio":
                return "🎵";
            case "pdf":
                return "📄";
            case "image":
                return "🖼️";
        }
    };

    // Compact mode for recording screen
    if (compact) {
        return (
            <div className={styles.compactContainer}>
                <button
                    className={styles.compactButton}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={acceptTypes}
                        onChange={(e) => handleFileSelect(e.target.files)}
                        className={styles.hiddenInput}
                    />
                    📄 {compactLabel}
                    {files.length > 0 && <span className={styles.compactBadge}>{files.length}</span>}
                </button>
                {files.length > 0 && (
                    <div className={styles.compactFileList}>
                        {files.map((file) => (
                            <div key={file.id} className={styles.compactFileItem}>
                                <span className={styles.compactFileIcon}>{getFileIcon(file.type)}</span>
                                <span className={styles.compactFileName}>{file.name}</span>
                                <button
                                    className={styles.compactRemoveButton}
                                    onClick={() => removeFile(file.id)}
                                    aria-label="削除"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div
                className={`${styles.dropzone} ${dragActive ? styles.active : ""}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={acceptTypes}
                    onChange={(e) => handleFileSelect(e.target.files)}
                    className={styles.hiddenInput}
                />
                <div className={styles.dropzoneContent}>
                    <span className={styles.uploadIcon}>
                        {isAudioOnly ? (
                            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                                <path d="M16 4a5 5 0 00-5 5v8a5 5 0 0010 0V9a5 5 0 00-5-5z" stroke="currentColor" strokeWidth="1.5" />
                                <path d="M8 17a8 8 0 0016 0M16 27v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        ) : "📁"}
                    </span>
                    <p className={styles.dropzoneText}>
                        {isAudioOnly ? "音声ファイルをドラッグ&ドロップ" : "ファイルをドラッグ&ドロップ"}
                        <br />
                        <span className={styles.dropzoneSubtext}>
                            または クリックして選択
                        </span>
                    </p>
                    <p className={styles.acceptedTypes}>
                        {isAudioOnly
                            ? "対応形式: MP3 / M4A / WAV / OGG / WebM"
                            : isPdfImageOnly
                                ? "対応形式: PDF / 画像 / テキスト"
                                : "対応形式: 音声 / PDF / 画像 / テキスト"
                        }
                    </p>
                </div>
            </div>

            {files.length > 0 && (
                <div className={styles.fileList}>
                    {files.map((file) => (
                        <div key={file.id} className={styles.fileItem}>
                            <span className={styles.fileIcon}>{getFileIcon(file.type)}</span>
                            <span className={styles.fileName}>
                                {file.name}
                                <span className={styles.fileSize}>
                                    ({(file.file.size / 1024 / 1024).toFixed(1)} MB)
                                </span>
                            </span>
                            <span className={styles.readyTag}>✅ 準備完了</span>
                            <button
                                className={styles.removeButton}
                                onClick={() => removeFile(file.id)}
                                aria-label="削除"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
