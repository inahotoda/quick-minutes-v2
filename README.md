# INAHO議事録 - Quick Minutes

AIを使って会議の議事録を自動生成するWebアプリケーションです。

## 機能

- 🎙️ 音声録音から議事録を生成
- 📝 文字起こしテキストから議事録を生成
- 📁 音声ファイル・PDF・画像をアップロードして議事録を生成
- 💾 Google Driveへの保存
- 📧 メール送信（商談モード）

## セットアップ

1. 依存関係をインストール
```bash
npm install
```

2. `.env.local` を作成
```bash
cp .env.example .env.local
# 各環境変数を設定
```

3. 開発サーバーを起動
```bash
npm run dev
```

## 環境変数

- `GOOGLE_CLIENT_ID` - Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth Client Secret
- `NEXTAUTH_SECRET` - NextAuth.js シークレット
- `NEXTAUTH_URL` - アプリのURL
- `GEMINI_API_KEY` - Google Gemini API キー
