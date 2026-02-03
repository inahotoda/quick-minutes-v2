"use client";

import { useState, useEffect, useMemo } from "react";
import styles from "./ProcessingScreen.module.css";

// カテゴリ分けされた多様なメッセージ
const MESSAGE_CATEGORIES = {
    // 🧘 リラックス・マインドフルネス
    relax: [
        "ゆっくり深呼吸してみましょう。4秒吸って、4秒止めて、4秒で吐く。",
        "遠くを見つめて目を休ませましょう。20秒で疲れが和らぎます。",
        "肩をゆっくり回してストレッチ。血行が良くなりますよ。",
        "両手を上に伸ばして、ゆっくり左右に傾けてみてください。",
        "足首をくるくる回すと、全身の血行がよくなります。",
        "一度、目を閉じて、静かに3回呼吸してみてください。",
    ],
    // ☕ ちょっとした提案
    suggestion: [
        "水分補給のチャンスです。脳の80%は水分でできています。",
        "少し席を立って、コーヒーや紅茶を淹れてきませんか？",
        "窓の外を眺めて、空の色を確認してみてください。",
        "観葉植物があれば、葉っぱを眺めてリフレッシュ。",
        "好きな曲を1曲聴きながら待つのもいいですね。",
        "この後の予定を頭の中で整理してみましょう。",
    ],
    // 🤖 AIと未来
    ai: [
        "AIは仕事を奪うのではなく、あなたの創造性を拡張するパートナーです。",
        "議事録の自動化で、年間約50時間を創造的な仕事に使えます。",
        "AIリアルタイム翻訳で、言語の壁なく世界中と協働できる時代に。",
        "定型業務はAIに任せ、人間は意思決定と関係構築に集中しましょう。",
        "会議の価値は「決定」と「次のアクション」。AIがそれを逃しません。",
        "AIは24時間働きますが、あなたは適度に休んでくださいね。",
        "将来、AIアシスタントがあなたの分身として会議に参加するかも。",
        "AIが進化しても、人間の「なぜ」を問う力は代替できません。",
    ],
    // 💡 インスピレーション
    inspiration: [
        "優れたアイデアは、リラックスしている時に生まれやすいそうです。",
        "「できるかどうか」より「やりたいかどうか」で決めると、うまくいくことが多い。",
        "失敗は成功のもと。でも、その前にちゃんと休息を。",
        "今日一日、何か一つ、自分を褒められることはありましたか？",
        "完璧を目指すより、まず完成させることが大切です。",
        "「忙しい」は「心を亡くす」と書きます。たまには立ち止まりましょう。",
        "創造性は、無駄に見える時間から生まれることがあります。",
    ],
    // 🎯 会議・仕事のヒント
    work: [
        "良い会議は、終わった後に全員が次のアクションを理解している会議です。",
        "会議中にメモを取る代わりに、AIに任せて議論に集中する時代です。",
        "1時間の会議より、30分で済む会議を目指しましょう。",
        "発言しなかった人にも、後で意見を聞いてみると良いかも。",
        "会議の目的を最初に確認するだけで、生産性が上がります。",
    ],
    // 🌟 ちょっとした豆知識
    trivia: [
        "人間の脳は、1日に約6万回の思考をしているそうです。",
        "植物のある部屋では、ストレスが約12%減少するという研究があります。",
        "20分の昼寝は、8時間睡眠の2時間分に相当するエネルギーを回復させます。",
        "笑うと免疫力が上がり、ストレスホルモンが減少します。",
        "青色は集中力を高め、緑色はリラックス効果があるそうです。",
        "手書きでメモを取ると、タイピングより記憶に残りやすいそうです。",
    ],
    // 🎨 遊び心
    playful: [
        "AIが議事録を書いている間、あなたは何を考えていますか？",
        "もし今、どこにでも瞬間移動できるなら、どこに行きたいですか？",
        "昨日の夕食、何を食べたか覚えていますか？",
        "もし1日が25時間あったら、その1時間で何をしますか？",
        "次の休日、何をしたいか、ぼんやり考えてみてください。",
        "世界中の言語を話せるとしたら、最初にどの国に行きますか？",
    ],
};

// すべてのメッセージをフラットな配列に
const ALL_MESSAGES = Object.values(MESSAGE_CATEGORIES).flat();

// シャッフル関数
const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

interface ProcessingScreenProps {
    audioBlob?: Blob | null;
    onCancel?: () => void;  // 中止して戻る
    onRetry?: () => void;   // リトライ
}

export default function ProcessingScreen({ audioBlob, onCancel, onRetry }: ProcessingScreenProps) {
    // 初回ロード時にシャッフルされたメッセージ配列を作成
    const shuffledMessages = useMemo(() => shuffleArray(ALL_MESSAGES), []);

    // 初期indexもランダムに
    const [messageIndex, setMessageIndex] = useState(() =>
        Math.floor(Math.random() * ALL_MESSAGES.length)
    );
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [fadeKey, setFadeKey] = useState(0);

    // 現在のメッセージ（シャッフル配列から順番に取得）
    const currentMessage = shuffledMessages[messageIndex % shuffledMessages.length];

    useEffect(() => {
        const timer = setInterval(() => {
            setElapsedSeconds((prev) => prev + 1);
        }, 1000);

        const messageTimer = setInterval(() => {
            setFadeKey((prev) => prev + 1);
            setMessageIndex((prev) => prev + 1);
        }, 10000); // 10秒ごとに次のメッセージ

        return () => {
            clearInterval(timer);
            clearInterval(messageTimer);
        };
    }, []);

    const totalSeconds = 120;
    const remainingSeconds = Math.max(totalSeconds - elapsedSeconds, 0);
    const progressPercent = Math.min((elapsedSeconds / totalSeconds) * 100, 100);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;

    // 2分経過したらバックアップボタンを表示
    const showBackupButton = elapsedSeconds >= totalSeconds && audioBlob;

    const handleDownloadBackup = () => {
        if (!audioBlob) return;
        const url = URL.createObjectURL(audioBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `会議録音_バックアップ_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.m4a`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <div className={styles.container}>
            {/* Futuristic Orb with Rings and Particles */}
            <div className={styles.orbContainer}>
                <div className={`${styles.ring} ${styles.ring3}`} />
                <div className={`${styles.ring} ${styles.ring1}`} />
                <div className={`${styles.ring} ${styles.ring2}`} />
                <div className={`${styles.particle} ${styles.particle1}`} />
                <div className={`${styles.particle} ${styles.particle2}`} />
                <div className={styles.orb}>
                    <div className={styles.orbCore} />
                </div>
            </div>

            <h2 className={styles.title}>会議、お疲れ様でした</h2>
            <p className={styles.subtitle}>価値ある対話を、確かな資産に変えています</p>

            {/* Timer */}
            <div className={styles.timerSection}>
                <div className={styles.countdown}>
                    {showBackupButton ? (
                        <span className={styles.overtimeText}>処理中...</span>
                    ) : (
                        `${minutes}:${seconds.toString().padStart(2, "0")}`
                    )}
                </div>
                <div className={styles.progressTrack}>
                    <div
                        className={`${styles.progressFill} ${showBackupButton ? styles.progressComplete : ""}`}
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* Message or Backup Warning */}
            {showBackupButton ? (
                <div className={styles.backupSection}>
                    <p className={styles.backupWarning}>
                        生成に時間がかかっています。
                        <br />
                        このまま待つか、中止して再試行してください。
                    </p>
                    <div className={styles.backupButtons}>
                        {onRetry && (
                            <button className={styles.retryButton} onClick={onRetry}>
                                🔄 リトライ
                            </button>
                        )}
                        {audioBlob && (
                            <button className={styles.backupButton} onClick={handleDownloadBackup}>
                                ⬇️ 音声をバックアップ
                            </button>
                        )}
                        {onCancel && (
                            <button className={styles.cancelButton} onClick={onCancel}>
                                ✕ トップに戻る
                            </button>
                        )}
                    </div>
                    <p className={styles.backupHint}>
                        待機を続けても問題ありません。完成したら自動的に表示されます。
                    </p>
                </div>
            ) : (
                <p className={styles.message} key={fadeKey}>
                    {currentMessage}
                </p>
            )}
        </div>
    );
}
