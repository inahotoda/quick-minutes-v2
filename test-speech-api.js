/**
 * Speech-to-Text API 接続テスト
 * 実行: node test-speech-api.js
 */

const { SpeechClient } = require("@google-cloud/speech");

async function testConnection() {
    console.log("🔍 Speech-to-Text API 接続テスト開始...\n");

    try {
        const client = new SpeechClient({
            projectId: "quickminutes-485312",
        });

        // 簡単なリクエストでAPIが使えるか確認
        console.log("✅ SpeechClient 初期化成功！");
        console.log("📍 プロジェクトID: quickminutes-485312");

        // 空のリクエストでAPIエンドポイントへの接続を確認
        // 注意: 実際の音声データがないのでエラーになるが、認証は確認できる
        const request = {
            config: {
                encoding: "WEBM_OPUS",
                sampleRateHertz: 48000,
                languageCode: "ja-JP",
            },
            audio: {
                content: Buffer.from("test").toString("base64"),
            },
        };

        await client.recognize(request);
        console.log("✅ API呼び出し成功！");

    } catch (error) {
        if (error.code === 3) {
            // INVALID_ARGUMENT - 音声データが無効だが、認証は成功している
            console.log("✅ API認証成功！（テストデータのため音声処理はスキップ）");
            console.log("\n🎉 Speech-to-Text API の設定は正常です！");
        } else if (error.code === 7) {
            // PERMISSION_DENIED
            console.error("❌ 権限エラー: Speech-to-Text APIが有効になっていません");
            console.error("   https://console.cloud.google.com/apis/library/speech.googleapis.com で有効化してください");
        } else if (error.code === 16) {
            // UNAUTHENTICATED
            console.error("❌ 認証エラー: gcloud auth application-default login を実行してください");
        } else {
            console.error("❌ エラー:", error.message);
            console.error("   コード:", error.code);
        }
    }
}

testConnection();
