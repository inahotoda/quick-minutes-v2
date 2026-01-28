import { lexer } from "marked";

/**
 * Google Docs API 向けに Markdown を解析し、スタイル付きドキュメントを作成する
 */
export async function createGoogleDocFromMarkdown(
    title: string,
    markdown: string,
    folderId: string,
    accessToken: string
): Promise<{ id: string; webViewLink: string }> {
    // 1. 空のドキュメントを作成
    const createResponse = await fetch(
        "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true",
        {
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
        }
    );

    if (!createResponse.ok) {
        const errData = await createResponse.json().catch(() => ({}));
        const message = errData.error?.message || createResponse.statusText;
        if (createResponse.status === 403) {
            throw new Error(
                `権限エラー: Googleドキュメントの作成権限がありません。一度ログアウトして再ログインしてください。(${message})`
            );
        }
        throw new Error(`ドキュメント作成失敗: ${createResponse.status} - ${message}`);
    }

    const docFile = await createResponse.json();
    const documentId = docFile.id;

    // 2. Markdownを解析してテキストとスタイルリクエストを構築
    const tokens = lexer(markdown);
    let fullText = "";
    const styleRequests: any[] = [];

    for (const token of tokens) {
        const t = token as any;

        if (token.type === "heading") {
            const start = fullText.length + 1;
            fullText += t.text + "\n";
            const end = fullText.length + 1;
            const headingLevel = Math.min(t.depth, 6);
            styleRequests.push({
                updateParagraphStyle: {
                    range: { startIndex: start, endIndex: end },
                    paragraphStyle: { namedStyleType: `HEADING_${headingLevel}` },
                    fields: "namedStyleType",
                },
            });
        } else if (token.type === "list") {
            for (const item of t.items || []) {
                const start = fullText.length + 1;
                const itemText = item.text || item.raw?.replace(/^[-*]\s*(\[.\])?\s*/, "") || "";
                fullText += itemText + "\n";
                const end = fullText.length + 1;

                // チェックリスト判定
                const isChecklist = item.checked !== undefined || /^\[.\]/.test(item.raw || "");

                styleRequests.push({
                    createParagraphBullets: {
                        range: { startIndex: start, endIndex: end },
                        bulletPreset: isChecklist ? "BULLET_CHECKBOX_PRESET" : "BULLET_DISC_CIRCLE_SQUARE",
                    },
                });
            }
        } else if (token.type === "paragraph") {
            fullText += t.text + "\n\n";
        } else if (token.type === "space") {
            // 空行は無視
        } else if (token.type === "hr") {
            fullText += "────────────────────────────────\n\n";
        } else {
            // その他（コードブロック、引用など）
            const text = t.text || t.raw || "";
            if (text) {
                fullText += text + "\n";
            }
        }
    }

    // 3. テキストを挿入
    if (fullText.trim()) {
        const insertResponse = await fetch(
            `https://www.googleapis.com/docs/v1/documents/${documentId}:batchUpdate`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    requests: [{ insertText: { location: { index: 1 }, text: fullText } }],
                }),
            }
        );

        if (!insertResponse.ok) {
            const errData = await insertResponse.json().catch(() => ({}));
            console.error("Insert text failed:", errData);
            // テキスト挿入失敗してもドキュメント自体は作成済みなので続行
        }

        // 4. スタイルを適用
        if (styleRequests.length > 0) {
            const styleResponse = await fetch(
                `https://www.googleapis.com/docs/v1/documents/${documentId}:batchUpdate`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ requests: styleRequests }),
                }
            );

            if (!styleResponse.ok) {
                const errData = await styleResponse.json().catch(() => ({}));
                console.error("Style application failed:", errData);
                // スタイル適用失敗しても続行
            }
        }
    }

    // 5. webViewLink を取得
    const getResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${documentId}?fields=webViewLink&supportsAllDrives=true`,
        {
            headers: { Authorization: `Bearer ${accessToken}` },
        }
    );

    let webViewLink = `https://docs.google.com/document/d/${documentId}/edit`;
    if (getResponse.ok) {
        const data = await getResponse.json();
        if (data.webViewLink) {
            webViewLink = data.webViewLink;
        }
    }

    return { id: documentId, webViewLink };
}
