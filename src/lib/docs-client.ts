import { lexer } from "marked";

/**
 * Google Docs API 向けに Markdown を解析し、BatchUpdate リクエストを生成する
 */
export async function createGoogleDocFromMarkdown(title: string, markdown: string, folderId: string, accessToken: string) {
    // 1. 空のドキュメントを作成
    const createResponse = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: title,
            mimeType: "application/vnd.google-apps.document",
            parents: [folderId],
        }),
    });

    const docFile = await createResponse.json();
    const documentId = docFile.id;

    // 2. コンテンツを解析してリクエストを作成
    const tokens = lexer(markdown);
    const requests: any[] = [];
    let currentIndex = 1; // Google Docs は 1-indexed (最初の[0]は \n 固定)

    // リバースオーダーで処理する必要がある場合もあるが、まずは素直に実装
    // 実際には insertText はインデックスが変わるので、後ろから入れるのが定石

    // しかし、一気に構築して最後に投げる場合は、インデックス計算が必要。
    // 面倒なので、一気に全テキストを入れてから、スタイルを適用するスタイルで行く。

    let fullText = "";
    const styleRequests: any[] = [];

    for (const token of tokens) {
        if (token.type === "heading") {
            const t = token as any;
            const start = fullText.length + 1;
            fullText += t.text + "\n";
            const end = fullText.length + 1;
            styleRequests.push({
                updateParagraphStyle: {
                    range: { startIndex: start, endIndex: end },
                    paragraphStyle: { namedStyleType: `HEADING_${t.depth}` },
                    fields: "namedStyleType",
                },
            });
        } else if (token.type === "list") {
            const t = token as any;
            for (const item of t.items) {
                const start = fullText.length + 1;
                fullText += item.text + "\n";
                const end = fullText.length + 1;

                if (item.checked !== undefined) {
                    styleRequests.push({
                        createParagraphBullets: {
                            range: { startIndex: start, endIndex: end },
                            bulletPreset: "BULLET_CHECKBOX_PRESET",
                        }
                    });
                } else {
                    styleRequests.push({
                        createParagraphBullets: {
                            range: { startIndex: start, endIndex: end },
                            bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
                        }
                    });
                }
            }
        } else if (token.type === "table") {
            const t = token as any;
            fullText += "（表の出力）\n";
            fullText += t.raw + "\n";
        } else if (token.type === "paragraph") {
            const t = token as any;
            fullText += t.text + "\n";
        } else if (token.type === "space") {
            // ignore
        } else {
            const t = token as any;
            fullText += t.raw || t.text || "";
            if (!fullText.endsWith("\n")) fullText += "\n";
        }
    }

    // 3. バッチアップデート実行
    await fetch(`https://www.googleapis.com/docs/v1/documents/${documentId}:batchUpdate`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            requests: [
                { insertText: { location: { index: 1 }, text: fullText } },
                ...styleRequests
            ],
        }),
    });

    return docFile;
}
