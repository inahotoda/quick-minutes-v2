"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Member, getAllMembers, addMember } from "@/lib/member-storage";
import { ConfirmedParticipant } from "./ParticipantConfirmation";
import styles from "./IntroductionScreen.module.css";

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionResultList {
    length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
    isFinal: boolean;
    length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
    transcript: string;
    confidence: number;
}

interface IntroductionScreenProps {
    duration: number;
    countdownFrom?: number; // 秒単位
    onComplete: (participants: ConfirmedParticipant[]) => void;
    onSkip: () => void;
    existingParticipants?: ConfirmedParticipant[];
}

// 自己紹介パターンから名前を抽出
const INTRO_PATTERNS = [
    /^(.{1,10})です[。、]?$/,
    /^(.{1,10})と申します/,
    /^私[はが、](.{1,10})です/,
    /^(.{1,10})と言います/,
    /^(.{1,10})といいます/,
    /^はじめまして[、。]?(.{1,10})です/,
    /^よろしく.*[、。]?(.{1,10})です/,
    /^お[疲つ]れ.*[、。]?(.{1,10})です/,
    /^おはよう.*[、。]?(.{1,10})です/,
];

function extractName(text: string): string | null {
    const cleaned = text.trim().replace(/\s+/g, "");
    for (const pattern of INTRO_PATTERNS) {
        const match = cleaned.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

export default function IntroductionScreen({
    duration,
    countdownFrom,
    onComplete,
    onSkip,
    existingParticipants = [],
}: IntroductionScreenProps) {
    const [participants, setParticipants] = useState<ConfirmedParticipant[]>(existingParticipants);
    const [members, setMembers] = useState<Member[]>([]);
    const [recognizedText, setRecognizedText] = useState("");
    const [lastRecognizedName, setLastRecognizedName] = useState<string | null>(null);
    const [isListening, setIsListening] = useState(false);
    const [showMemberPicker, setShowMemberPicker] = useState(false);

    const recognitionRef = useRef<any>(null);
    const audioRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const nameRecordingMapRef = useRef<Map<string, { blob: Blob; timestamp: number }>>(new Map());

    // Load existing members
    useEffect(() => {
        const load = async () => {
            const data = await getAllMembers();
            setMembers(data);
        };
        load();
    }, []);

    // Initialize speech recognition
    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("Speech Recognition not supported");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = "ja-JP";
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let finalTranscript = "";
            let interimTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    finalTranscript += result[0].transcript;
                } else {
                    interimTranscript += result[0].transcript;
                }
            }

            // Show interim results
            if (interimTranscript) {
                setRecognizedText(interimTranscript);
            }

            // Process final results
            if (finalTranscript) {
                setRecognizedText(finalTranscript);
                const name = extractName(finalTranscript);
                if (name) {
                    handleNameRecognized(name, finalTranscript);
                }
            }
        };

        recognition.onend = () => {
            // Restart if still listening
            if (isListening) {
                try {
                    recognition.start();
                } catch {
                    // Ignore errors
                }
            }
        };

        recognitionRef.current = recognition;

        return () => {
            recognition.stop();
        };
    }, []);

    // Start listening and audio recording
    useEffect(() => {
        const startListening = async () => {
            try {
                // Start speech recognition
                if (recognitionRef.current) {
                    recognitionRef.current.start();
                    setIsListening(true);
                }

                // Start audio recording for voice samples
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mediaRecorder = new MediaRecorder(stream, {
                    mimeType: "audio/webm;codecs=opus",
                });

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) {
                        audioChunksRef.current.push(e.data);
                    }
                };

                audioRecorderRef.current = mediaRecorder;
                mediaRecorder.start(1000); // Collect data every 1 second
            } catch (error) {
                console.error("Failed to start recognition:", error);
            }
        };

        startListening();

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
            if (audioRecorderRef.current?.state === "recording") {
                audioRecorderRef.current.stop();
            }
        };
    }, []);

    // Handle recognized name
    const handleNameRecognized = useCallback((name: string, fullText: string) => {
        setLastRecognizedName(name);

        // Check if already added
        if (participants.some((p) => p.name === name)) {
            return;
        }

        // Check if this is an existing member
        const existingMember = members.find((m) => m.name.includes(name) || name.includes(m.name));

        // Create voice blob from recent audio
        const voiceBlob = audioChunksRef.current.length > 0
            ? new Blob(audioChunksRef.current.slice(-3), { type: "audio/webm" })
            : undefined;

        // Add new participant
        const newParticipant: ConfirmedParticipant = {
            id: existingMember?.id || `new-${Date.now()}`,
            name: existingMember?.name || name,
            hasVoice: !!voiceBlob || !!existingMember?.voiceSample,
            voiceBlob: voiceBlob || existingMember?.voiceSample?.blob,
        };

        setParticipants((prev) => [...prev, newParticipant]);

        // Save voice sample for new participants
        if (!existingMember && voiceBlob) {
            nameRecordingMapRef.current.set(name, { blob: voiceBlob, timestamp: Date.now() });
        }

        // Reset for next person
        setTimeout(() => {
            setRecognizedText("");
            setLastRecognizedName(null);
        }, 2000);
    }, [participants, members]);

    // Add existing member manually
    const handleAddExistingMember = (member: Member) => {
        if (participants.some((p) => p.id === member.id)) return;

        setParticipants((prev) => [
            ...prev,
            {
                id: member.id,
                name: member.name,
                hasVoice: !!member.voiceSample,
                voiceBlob: member.voiceSample?.blob,
            },
        ]);
        setShowMemberPicker(false);
    };

    // Remove participant
    const handleRemoveParticipant = (id: string) => {
        setParticipants((prev) => prev.filter((p) => p.id !== id));
    };

    // Complete introduction
    const handleComplete = async () => {
        // Save new members to IndexedDB and update their IDs
        const updatedParticipants = [...participants];

        for (let i = 0; i < updatedParticipants.length; i++) {
            const p = updatedParticipants[i];
            if (p.id.startsWith("new-")) {
                const recording = nameRecordingMapRef.current.get(p.name);
                const duration = recording ? (Date.now() - recording.timestamp) / 1000 : 0;
                try {
                    const savedMember = await addMember(p.name, recording?.blob, duration > 0 ? duration : undefined);
                    // Update with saved member ID
                    updatedParticipants[i] = {
                        ...p,
                        id: savedMember.id,
                        hasVoice: !!savedMember.voiceSample,
                        voiceBlob: savedMember.voiceSample?.blob,
                    };
                } catch (error) {
                    console.error("Failed to save member:", error);
                }
            }
        }

        onComplete(updatedParticipants);
    };

    // Format time
    const formatTime = (seconds: number) => {
        const mins = Math.floor(Math.abs(seconds) / 60);
        const secs = Math.abs(seconds) % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    // Countdown calculation
    const remainingTime = countdownFrom ? countdownFrom - duration : null;
    const displayTime = remainingTime !== null
        ? (remainingTime > 0 ? remainingTime : 0)
        : duration;

    // Get available members (not yet added)
    const availableMembers = members.filter((m) => !participants.some((p) => p.id === m.id));

    return (
        <div className={styles.container}>
            {/* Title */}
            <div className={styles.titleSection}>
                <div className={styles.aiIcon}>
                    <div className={styles.aiIconCore} />
                    <div className={styles.aiIconRing} />
                </div>
                <h2 className={styles.title}>ボイスエントリー</h2>
            </div>

            {/* Waveform Visualizer */}
            <div className={styles.waveformContainer}>
                {Array.from({ length: 12 }).map((_, i) => (
                    <div
                        key={i}
                        className={`${styles.waveBar} ${styles.waveBarActive}`}
                    />
                ))}
            </div>

            {/* Recognition Status */}
            <div className={styles.recognitionSection}>
                {lastRecognizedName ? (
                    <div className={styles.nameRecognized}>
                        <span className={styles.nameRecognizedIcon}>✨</span>
                        <span className={styles.nameRecognizedText}>{lastRecognizedName}さん</span>
                        <span className={styles.nameRecognizedLabel}>認識しました！</span>
                    </div>
                ) : recognizedText ? (
                    <div className={styles.listening}>
                        <span className={styles.listeningDot} />
                        <span className={styles.listeningText}>{recognizedText}</span>
                    </div>
                ) : (
                    <div className={styles.instructions}>
                        <p className={styles.instructionText}>
                            順番に「〇〇です」と<br />
                            お名前をお伝えください
                        </p>
                        <p className={styles.instructionHint}>
                            AIがリアルタイムで認識します
                        </p>
                    </div>
                )}
            </div>

            {/* Timer */}
            <div className={`${styles.timer} ${remainingTime !== null && remainingTime <= 60 ? styles.timerWarning : ''}`}>
                ⏱️ {formatTime(displayTime)}
            </div>

            {/* Participant List */}
            <div className={styles.participantsSection}>
                <div className={styles.participantsHeader}>
                    <span className={styles.participantsLabel}>認識済み参加者 ({participants.length})</span>
                    {availableMembers.length > 0 && (
                        <button
                            className={styles.addMemberButton}
                            onClick={() => setShowMemberPicker(!showMemberPicker)}
                        >
                            + 登録メンバーから追加
                        </button>
                    )}
                </div>

                {/* Participant Cards */}
                <div className={styles.participantCards}>
                    {participants.map((p) => (
                        <div key={p.id} className={styles.participantCard}>
                            <span className={styles.participantName}>{p.name}</span>
                            {p.hasVoice && <span className={styles.voiceBadge}>🎵</span>}
                            <button
                                className={styles.removeButton}
                                onClick={() => handleRemoveParticipant(p.id)}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {participants.length === 0 && (
                        <div className={styles.noParticipants}>
                            まだ誰も認識されていません
                        </div>
                    )}
                </div>

                {/* Member Picker Dropdown */}
                {showMemberPicker && availableMembers.length > 0 && (
                    <div className={styles.memberPicker}>
                        {availableMembers.map((m) => (
                            <button
                                key={m.id}
                                className={styles.memberPickerItem}
                                onClick={() => handleAddExistingMember(m)}
                            >
                                <span>👤 {m.name}</span>
                                {m.voiceSample && <span>🎵</span>}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Complete Button */}
            <button className={styles.completeButton} onClick={handleComplete}>
                <span className={styles.startIcon}>▶</span>
                Mtgスタート ({participants.length}名)
            </button>

            {/* Skip */}
            <button className={styles.skipButton} onClick={onSkip}>
                スキップして会議を開始 →
            </button>
        </div>
    );
}
