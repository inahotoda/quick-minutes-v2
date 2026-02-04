"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import styles from "./page.module.css";

export default function LandingPage() {
    const sectionsRef = useRef<(HTMLElement | null)[]>([]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add(styles.visible);
                    }
                });
            },
            { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
        );

        sectionsRef.current.forEach((section) => {
            if (section) observer.observe(section);
        });

        return () => observer.disconnect();
    }, []);

    const setRef = (index: number) => (el: HTMLElement | null) => {
        sectionsRef.current[index] = el;
    };

    return (
        <div className={styles.container}>
            {/* Hero Section */}
            <section className={styles.hero}>
                <div className={styles.heroContent}>
                    <h1 className={styles.heroTitle}>
                        語り合ったすべてを、
                        <br />
                        <span className={styles.highlight}>最高の形へ。</span>
                    </h1>
                    <p className={styles.heroSubtitle}>
                        Voices to Forms, Intelligence to Future.
                        <br />
                        <span className={styles.heroAccent}>対話は、AIで同期する。</span>
                    </p>
                    <Link href="/" className={styles.ctaButton}>
                        今すぐ使う
                    </Link>
                </div>
                <div className={styles.scrollIndicator}>
                    <span>Scroll</span>
                    <div className={styles.scrollLine}></div>
                </div>
            </section>

            {/* Features Section */}
            <section ref={setRef(0)} className={`${styles.section} ${styles.fadeUp}`}>
                <h2 className={styles.sectionTitle}>シンプルな3ステップ</h2>
                <div className={styles.features}>
                    <div className={styles.featureCard}>
                        <div className={styles.featureIcon}>🎤</div>
                        <h3>録音する</h3>
                        <p>会議中にボタンひとつで録音開始。バックグラウンドでも動作します。</p>
                    </div>
                    <div className={styles.featureArrow}>→</div>
                    <div className={styles.featureCard}>
                        <div className={styles.featureIcon}>🤖</div>
                        <h3>AIが生成</h3>
                        <p>最新のAIが音声を解析し、発言者を識別しながら議事録を自動生成。</p>
                    </div>
                    <div className={styles.featureArrow}>→</div>
                    <div className={styles.featureCard}>
                        <div className={styles.featureIcon}>💾</div>
                        <h3>保存・共有</h3>
                        <p>Google Driveにワンクリック保存。チームとすぐに共有できます。</p>
                    </div>
                </div>
            </section>

            {/* Highlights Section */}
            <section ref={setRef(1)} className={`${styles.section} ${styles.fadeUp}`}>
                <h2 className={styles.sectionTitle}>なぜINAHO議事録なのか</h2>
                <div className={styles.highlights}>
                    <div className={styles.highlightItem}>
                        <div className={styles.highlightNumber}>01</div>
                        <div className={styles.highlightContent}>
                            <h3>発言者を自動識別</h3>
                            <p>「誰が何を言ったか」をAIが自動で判別。名前付きで議事録に反映されます。</p>
                        </div>
                    </div>
                    <div className={styles.highlightItem}>
                        <div className={styles.highlightNumber}>02</div>
                        <div className={styles.highlightContent}>
                            <h3>複数デバイス対応</h3>
                            <p>Mac、iPhone、iPad、どこでも使えるPWA対応。いつでも会議を記録。</p>
                        </div>
                    </div>
                    <div className={styles.highlightItem}>
                        <div className={styles.highlightNumber}>03</div>
                        <div className={styles.highlightContent}>
                            <h3>Google連携</h3>
                            <p>Googleアカウントでログイン。Google Driveに直接保存できます。</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section ref={setRef(2)} className={`${styles.section} ${styles.ctaSection} ${styles.fadeUp}`}>
                <h2 className={styles.ctaTitle}>
                    会議の価値を
                    <br />
                    最大化しよう
                </h2>
                <p className={styles.ctaDescription}>
                    手書きメモや録音の聞き直しはもう不要。
                    <br />
                    AIがあなたの会議を、アクションへと変換します。
                </p>
                <Link href="/" className={styles.ctaButtonLarge}>
                    今すぐ議事録を始める
                </Link>
            </section>

            {/* Footer */}
            <footer className={styles.footer}>
                <p>INAHO 議事録 — Powered by AI</p>
            </footer>
        </div>
    );
}
