"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export function useAudioRecorder() {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isInterrupted, setIsInterrupted] = useState(false);
    const [duration, setDuration] = useState(0);
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<NodeJS.Timeout | null>(null);

    // トラックの監視設定
    const monitorTrack = (stream: MediaStream) => {
        const track = stream.getAudioTracks()[0];
        if (track) {
            track.onmute = () => {
                console.log("Audio track muted - possible interruption");
                setIsInterrupted(true);
            };
            track.onunmute = () => {
                console.log("Audio track unmuted");
                setIsInterrupted(false);
            };
            track.onended = () => {
                console.log("Audio track ended");
                setIsInterrupted(true);
            };
        }
    };

    const startRecording = useCallback(async (isResume = false) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            monitorTrack(stream);

            let mimeType = "";
            if (MediaRecorder.isTypeSupported("audio/mp4")) {
                mimeType = "audio/mp4";
            } else if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
                mimeType = "audio/webm;codecs=opus";
            } else if (MediaRecorder.isTypeSupported("audio/webm")) {
                mimeType = "audio/webm";
            }

            console.log("Starting recording with mimeType:", mimeType);
            const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
            mediaRecorderRef.current = mediaRecorder;

            if (!isResume) {
                chunksRef.current = [];
                setDuration(0);
            }

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.start(1000);
            setIsRecording(true);
            setIsPaused(false);
            setIsInterrupted(false);

            if (timerRef.current) clearInterval(timerRef.current);
            timerRef.current = setInterval(() => {
                setDuration((d: number) => d + 1);
            }, 1000);
        } catch (error) {
            console.error("録音の開始に失敗しました:", error);
            setIsInterrupted(true);
            throw error;
        }
    }, []);

    // 中断からの再開（ワンタップで実行）
    const resumeInterrupted = useCallback(async () => {
        await startRecording(true);
    }, [startRecording]);

    const stopRecording = useCallback((): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            if (!mediaRecorderRef.current || !isRecording) {
                // すでに中断されている場合でも、それまでのチャンクがあればBlob化する
                if (chunksRef.current.length > 0) {
                    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                    setAudioBlob(blob);
                    resolve(blob);
                    return;
                }
                reject(new Error("録音中ではありません"));
                return;
            }

            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                setAudioBlob(blob);

                if (streamRef.current) {
                    streamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
                }

                resolve(blob);
            };

            if (mediaRecorderRef.current.state !== "inactive") {
                mediaRecorderRef.current.stop();
            } else {
                // すでに停止している場合
                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                setAudioBlob(blob);
                resolve(blob);
            }

            setIsRecording(false);
            setIsPaused(false);
            setIsInterrupted(false);

            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        });
    }, [isRecording]);

    // Visibility change の監視（アプリ復帰時の自動チェック）
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible" && isRecording) {
                // 復帰時にマイクの状態を確認
                const track = streamRef.current?.getAudioTracks()[0];
                if (track && (track.readyState === "ended" || track.muted)) {
                    setIsInterrupted(true);
                }
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, [isRecording]);

    const pauseRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording && !isPaused) {
            mediaRecorderRef.current.pause();
            setIsPaused(true);

            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }
    }, [isRecording, isPaused]);

    const resumeRecording = useCallback(() => {
        if (mediaRecorderRef.current && isRecording && isPaused) {
            mediaRecorderRef.current.resume();
            setIsPaused(false);

            timerRef.current = setInterval(() => {
                setDuration((d: number) => d + 1);
            }, 1000);
        }
    }, [isRecording, isPaused]);

    const resetRecording = useCallback(() => {
        setAudioBlob(null);
        setDuration(0);
        chunksRef.current = [];
        setIsInterrupted(false);
    }, []);

    // Reset only duration (for countdown timer extend)
    const resetDuration = useCallback(() => {
        setDuration(0);
    }, []);

    return {
        isRecording,
        isPaused,
        isInterrupted,
        duration,
        audioBlob,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        resetRecording,
        resetDuration,
        resumeInterrupted,
    };
}

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
