"use client";

import { useRef, useState } from "react";
import { UploadedFile } from "@/types";
import styles from "./FileUpload.module.css";

interface FileUploadProps {
    files: UploadedFile[];
    onFilesChange: (files: UploadedFile[]) => void;
    acceptTypes?: string;
}

export default function FileUpload({
    files,
    onFilesChange,
    acceptTypes = "audio/*,application/pdf,image/*,.txt",
}: FileUploadProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragActive, setDragActive] = useState(false);

    const handleFileSelect = (selectedFiles: FileList | null) => {
        if (!selectedFiles) return;

        const newFiles: UploadedFile[] = [];

        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            let type: UploadedFile["type"] = "image";

            if (file.type.startsWith("audio/")) {
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
                    <span className={styles.uploadIcon}>📁</span>
                    <p className={styles.dropzoneText}>
                        ファイルをドラッグ&ドロップ
                        <br />
                        <span className={styles.dropzoneSubtext}>
                            または クリックして選択
                        </span>
                    </p>
                    <p className={styles.acceptedTypes}>
                        対応形式: 音声 / PDF / 画像 / テキスト
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
