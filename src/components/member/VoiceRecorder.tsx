"use client";

import { useState, useRef, useCallback } from "react";

/** Combined name extraction patterns from Japanese speech */
const INTRO_PATTERNS = [
    // Full self-introduction patterns (e.g. "私は田中です", "わたしの名前は山田と申します")
    /(?:私(?:は|の名前は)?|わたし(?:は|の名前は)?|僕(?:は|の名前は)?|ぼく(?:は|の名前は)?)(.+?)(?:です|と申します|といいます)/,
    // Prefix patterns (e.g. "私が田中です")
    /^私[はが、](.{1,10})です/,
    // Suffix patterns (e.g. "田中です", "山田と申します", "鈴木っす")
    /^(.{1,10})です[。、]?$/,
    /^(.{1,10})と申します/,
    /^(.{1,10})といいます/,
    /^(.{1,10})と言います/,
    /(.+?)(?:です|と申します|といいます|っす)$/,
];

/**
 * Extract a person's name from recognized Japanese speech text.
 * Tries multiple self-introduction patterns commonly used in Japanese.
 */
export function extractNameFromSpeech(text: string): string | null {
    const cleaned = text.trim().replace(/\s+/g, "");
    for (const pattern of INTRO_PATTERNS) {
        const match = cleaned.match(pattern);
        if (match && match[1]) return match[1];
    }
    return null;
}

export interface UseVoiceRecorderReturn {
    isRecording: boolean;
    recordingTimeLeft: number;
    recognizedName: string | null;
    voiceBlob: Blob | null;
    voiceDuration: number;
    startRecording: () => Promise<void>;
    stopRecording: () => Promise<{ blob: Blob; duration: number } | null>;
    resetRecording: () => void;
    isManualInput: boolean;
    setIsManualInput: (value: boolean) => void;
}

/**
 * Hook that encapsulates MediaRecorder + SpeechRecognition with a 10-second countdown.
 * Extracts names from Japanese speech patterns and manages voice recording state.
 */
export function useVoiceRecorder(): UseVoiceRecorderReturn {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTimeLeft, setRecordingTimeLeft] = useState(10);
    const [recognizedName, setRecognizedName] = useState<string | null>(null);
    const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
    const [voiceDuration, setVoiceDuration] = useState(0);
    const [isManualInput, setIsManualInput] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingStartRef = useRef<number>(0);
    const chunksRef = useRef<Blob[]>([]);
    const recognitionRef = useRef<any>(null);
    const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: "audio/webm;codecs=opus",
            });

            chunksRef.current = [];
            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = () => {
                setIsRecording(false);
                stream.getTracks().forEach((track) => track.stop());
            };

            mediaRecorderRef.current = mediaRecorder;
            recordingStartRef.current = Date.now();
            mediaRecorder.start();
            setIsRecording(true);
            setRecordingTimeLeft(10);

            // 10-second countdown with auto-stop
            countdownIntervalRef.current = setInterval(() => {
                setRecordingTimeLeft((prev) => {
                    if (prev <= 1) {
                        clearInterval(countdownIntervalRef.current!);
                        countdownIntervalRef.current = null;

                        // Save voice data
                        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                        const duration = (Date.now() - recordingStartRef.current) / 1000;
                        setVoiceBlob(blob);
                        setVoiceDuration(duration);

                        // Stop recording
                        if (mediaRecorderRef.current?.state === "recording") {
                            mediaRecorderRef.current.stop();
                        }
                        if (recognitionRef.current) {
                            try { recognitionRef.current.stop(); } catch { /* ignore */ }
                        }
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);

            // Start speech recognition
            const SpeechRecognition =
                (window as any).SpeechRecognition ||
                (window as any).webkitSpeechRecognition;

            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.lang = "ja-JP";
                recognition.continuous = false;
                recognition.interimResults = true;

                recognition.onresult = (event: any) => {
                    for (let i = 0; i < event.results.length; i++) {
                        const result = event.results[i];
                        if (result.isFinal) {
                            const text = result[0].transcript;
                            const name = extractNameFromSpeech(text);
                            if (name) {
                                setRecognizedName(name);
                                // Save voice data on successful name recognition
                                const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                                const duration = (Date.now() - recordingStartRef.current) / 1000;
                                setVoiceBlob(blob);
                                setVoiceDuration(duration);
                            }
                        }
                    }
                };

                recognitionRef.current = recognition;
                recognition.start();
            }
        } catch (error) {
            console.error("Failed to start recording:", error);
            alert("マイクへのアクセスを許可してください");
        }
    }, []);

    const stopRecording = useCallback((): Promise<{ blob: Blob; duration: number } | null> => {
        // Clear countdown timer
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }

        // Stop speech recognition
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch { /* ignore */ }
        }

        return new Promise((resolve) => {
            if (mediaRecorderRef.current?.state === "recording") {
                mediaRecorderRef.current.addEventListener(
                    "stop",
                    () => {
                        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
                        const duration = (Date.now() - recordingStartRef.current) / 1000;
                        setVoiceBlob(blob);
                        setVoiceDuration(duration);
                        resolve({ blob, duration });
                    },
                    { once: true }
                );
                mediaRecorderRef.current.stop();
            } else {
                // Already stopped - return current state
                if (voiceBlob) {
                    resolve({ blob: voiceBlob, duration: voiceDuration });
                } else {
                    resolve(null);
                }
            }
        });
    }, [voiceBlob, voiceDuration]);

    const resetRecording = useCallback(() => {
        // Clear countdown timer
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }

        // Stop active recording
        if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop();
        }

        // Stop speech recognition
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch { /* ignore */ }
        }

        setIsRecording(false);
        setRecordingTimeLeft(10);
        setRecognizedName(null);
        setVoiceBlob(null);
        setVoiceDuration(0);
        setIsManualInput(false);
    }, []);

    return {
        isRecording,
        recordingTimeLeft,
        recognizedName,
        voiceBlob,
        voiceDuration,
        startRecording,
        stopRecording,
        resetRecording,
        isManualInput,
        setIsManualInput,
    };
}
