"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
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

            {/* Device Showcase Section */}
            <section ref={setRef(0)} className={`${styles.section} ${styles.showcaseSection} ${styles.fadeUp}`}>
                <div className={styles.showcaseContent}>
                    <h2 className={styles.showcaseTitle}>どこでも、すぐに。</h2>
                    <p className={styles.showcaseDescription}>
                        MacでもiPhoneでも。デバイスを選ばず、
                        <br />
                        あなたの会議を最高の議事録に変換します。
                    </p>
                </div>
                <div className={styles.deviceImage}>
                    <Image
                        src="/images/hero-devices.png"
                        alt="INAHO議事録 - MacとiPhoneでの表示"
                        width={900}
                        height={600}
                        priority
                    />
                </div>
            </section>

            {/* How it Works Section */}
            <section ref={setRef(1)} className={`${styles.section} ${styles.fadeUp}`}>
                <h2 className={styles.sectionTitle}>録音して、待つだけ。</h2>
                <p className={styles.sectionSubtitle}>あとはAIがすべてを整理します。</p>
                <div className={styles.steps}>
                    <div className={styles.stepItem}>
                        <div className={styles.stepNumber}>1</div>
                        <div className={styles.stepContent}>
                            <h3>録音</h3>
                            <p>ボタンひとつで録音開始。会議中は他のアプリを使っていても大丈夫。</p>
                        </div>
                    </div>
                    <div className={styles.stepLine}></div>
                    <div className={styles.stepItem}>
                        <div className={styles.stepNumber}>2</div>
                        <div className={styles.stepContent}>
                            <h3>AI解析</h3>
                            <p>発言者を自動識別。誰が何を話したか、すべて記録されます。</p>
                        </div>
                    </div>
                    <div className={styles.stepLine}></div>
                    <div className={styles.stepItem}>
                        <div className={styles.stepNumber}>3</div>
                        <div className={styles.stepContent}>
                            <h3>保存</h3>
                            <p>Google Driveにワンクリック保存。チームとすぐに共有。</p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section ref={setRef(2)} className={`${styles.section} ${styles.featuresSection} ${styles.fadeUp}`}>
                <div className={styles.featureGrid}>
                    <div className={styles.featureItem}>
                        <h3>発言者識別</h3>
                        <p>AIが声を聞き分け、「誰が言ったか」を自動で記録。</p>
                    </div>
                    <div className={styles.featureItem}>
                        <h3>PWA対応</h3>
                        <p>アプリのようにインストール可能。オフラインでも録音できます。</p>
                    </div>
                    <div className={styles.featureItem}>
                        <h3>Google連携</h3>
                        <p>ログインからドライブ保存まで、Googleアカウントひとつで完結。</p>
                    </div>
                    <div className={styles.featureItem}>
                        <h3>会議モード</h3>
                        <p>社内会議・商談など、シーンに合わせた最適なフォーマットを自動選択。</p>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section ref={setRef(3)} className={`${styles.section} ${styles.ctaSection} ${styles.fadeUp}`}>
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
                <p>INAHO 議事録 — Powered by INAHO Manufacturing Ltd.</p>
            </footer>
        </div>
    );
}
