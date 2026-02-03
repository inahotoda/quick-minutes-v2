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

## Google Driveアクセス権

このアプリを利用するには、議事録保存用の共有ドライブへのアクセス権が必要です。

### アクセス権のリクエスト方法

1. アプリにログイン後、アクセス権がない場合は案内が表示されます
2. 表示されるリンクから共有ドライブにアクセスし、「アクセス権をリクエスト」をクリック
3. 管理者の承認後、アプリを再読み込みしてご利用ください

### 管理者向け：共有ドライブID

- アクセス権確認用共有ドライブID: `0AEGO8vJJ35GMUk9PVA`
- 設定保存用フォルダID: `1gl7woInG6oJ5UuaRI54h_TTRbGatzWMY`

## 環境変数

- `GOOGLE_CLIENT_ID` - Google OAuth Client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth Client Secret
- `NEXTAUTH_SECRET` - NextAuth.js シークレット
- `NEXTAUTH_URL` - アプリのURL
- `GEMINI_API_KEY` - Google Gemini API キー
