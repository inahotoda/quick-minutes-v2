import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { lexer } from "marked";

/**
 * Google Docs API を使って Markdown をスタイル付きドキュメントに変換
 * CORSを回避するためサーバーサイドで実行
 */
export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.accessToken) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const { title, markdown, folderId } = await request.json();
        if (!title || !markdown || !folderId) {
            return NextResponse.json({ error: "必須パラメータが不足しています" }, { status: 400 });
        }

        const accessToken = session.accessToken as string;

        // 1. 空のドキュメントを作成
        console.log("[Docs API] Creating empty document...");
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
            console.error("[Docs API] Create document failed:", createResponse.status, errData);
            return NextResponse.json(
                { error: `ドキュメント作成失敗: ${errData.error?.message || createResponse.statusText}` },
                { status: createResponse.status }
            );
        }

        const docFile = await createResponse.json();
        const documentId = docFile.id;
        console.log("[Docs API] Document created:", documentId);

        // 2. Markdownを解析
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
            } else if (token.type === "table") {
                // テーブルをチェックリスト形式に変換
                const header = t.header || [];
                const rows = t.rows || [];

                for (const row of rows) {
                    const cells = row.map((cell: any) => cell.text || cell.raw || "").filter((c: string) => c.trim());
                    if (cells.length > 0) {
                        const start = fullText.length + 1;
                        // 各セルを「項目: 値」形式でまとめる
                        const rowContent = cells.join(" / ");
                        fullText += rowContent + "\n";
                        const end = fullText.length + 1;

                        // タスク関連のキーワードがあればチェックボックス化
                        const isTask = /task|todo|タスク|実行|アクション|to do/i.test(rowContent);
                        styleRequests.push({
                            createParagraphBullets: {
                                range: { startIndex: start, endIndex: end },
                                bulletPreset: isTask ? "BULLET_CHECKBOX_PRESET" : "BULLET_DISC_CIRCLE_SQUARE",
                            },
                        });
                    }
                }
                fullText += "\n";
            } else if (token.type === "list") {
                for (const item of t.items || []) {
                    const start = fullText.length + 1;
                    let itemText = item.text || item.raw || "";

                    // チェックリスト形式 `- [ ]` または `- [x]` を検出
                    const checklistMatch = itemText.match(/^\s*\[[ x]\]\s*/i);
                    const hasChecklistSyntax = checklistMatch !== null || item.checked !== undefined;

                    // チェックリスト記号を除去
                    if (checklistMatch) {
                        itemText = itemText.replace(/^\s*\[[ x]\]\s*/i, "");
                    }
                    // 先頭の - * なども除去
                    itemText = itemText.replace(/^[-*]\s*/, "").trim();

                    if (itemText) {
                        fullText += itemText + "\n";
                        const end = fullText.length + 1;

                        // タスク関連キーワードの検出
                        const isTask = hasChecklistSyntax ||
                            /担当[:\s：]|期限[:\s：]|タスク|todo|実行タスク|アクション/i.test(itemText);

                        styleRequests.push({
                            createParagraphBullets: {
                                range: { startIndex: start, endIndex: end },
                                bulletPreset: isTask ? "BULLET_CHECKBOX_PRESET" : "BULLET_DISC_CIRCLE_SQUARE",
                            },
                        });
                    }
                }
            } else if (token.type === "paragraph") {
                // 段落内に【】形式がある場合、箇条書きに変換
                const text = t.text || "";
                if (/【[^】]+】/.test(text)) {
                    // 【】形式を検出 - 各行を箇条書きに
                    const lines = text.split(/\n/);
                    for (const line of lines) {
                        if (line.trim()) {
                            const start = fullText.length + 1;
                            fullText += line.trim() + "\n";
                            const end = fullText.length + 1;

                            const isTask = /担当|期限|タスク|実行/i.test(line);
                            styleRequests.push({
                                createParagraphBullets: {
                                    range: { startIndex: start, endIndex: end },
                                    bulletPreset: isTask ? "BULLET_CHECKBOX_PRESET" : "BULLET_DISC_CIRCLE_SQUARE",
                                },
                            });
                        }
                    }
                } else {
                    fullText += text + "\n\n";
                }
            } else if (token.type === "hr") {
                fullText += "────────────────────────────────\n\n";
            } else if (token.type !== "space") {
                const text = t.text || t.raw || "";
                if (text) fullText += text + "\n";
            }
        }

        // 3. テキストを挿入
        let insertError: string | null = null;
        if (fullText.trim()) {
            console.log("[Docs API] Inserting text, length:", fullText.length);
            console.log("[Docs API] First 200 chars:", fullText.substring(0, 200));

            // 正しいエンドポイント: docs.googleapis.com （www.googleapis.com ではない）
            const insertUrl = `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`;
            console.log("[Docs API] Insert URL:", insertUrl);
            console.log("[Docs API] Document ID:", documentId);

            const insertResponse = await fetch(
                insertUrl,
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

            console.log("[Docs API] Insert response status:", insertResponse.status);

            if (!insertResponse.ok) {
                const errText = await insertResponse.text();
                console.error("[Docs API] Insert text failed, status:", insertResponse.status);
                console.error("[Docs API] Full error response:", errText);
                // Parse error message from JSON if possible
                let errMsg = "unknown";
                try {
                    const errJson = JSON.parse(errText);
                    errMsg = errJson.error?.message || errText.substring(0, 200);
                } catch {
                    errMsg = errText.substring(0, 200);
                }
                insertError = `テキスト挿入失敗 (${insertResponse.status}): ${errMsg}`;
            } else {
                console.log("[Docs API] Text inserted successfully");

                // 4. スタイルを適用
                if (styleRequests.length > 0) {
                    console.log("[Docs API] Applying", styleRequests.length, "style requests");
                    const styleResponse = await fetch(
                        `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
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
                        console.error("[Docs API] Style failed:", styleResponse.status, errData);
                    } else {
                        console.log("[Docs API] Styles applied successfully");
                    }
                }
            }
        } else {
            console.warn("[Docs API] No text to insert! Markdown parsing may have failed.");
            insertError = "Markdown解析結果が空です";
        }

        // 5. webViewLink を取得
        const getResponse = await fetch(
            `https://www.googleapis.com/drive/v3/files/${documentId}?fields=webViewLink&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        let webViewLink = `https://docs.google.com/document/d/${documentId}/edit`;
        if (getResponse.ok) {
            const data = await getResponse.json();
            if (data.webViewLink) webViewLink = data.webViewLink;
        }

        console.log("[Docs API] Complete, webViewLink:", webViewLink, "insertError:", insertError);
        return NextResponse.json({ id: documentId, webViewLink, insertError });
    } catch (error: any) {
        console.error("[Docs API] Error:", error);
        return NextResponse.json({ error: error.message || "不明なエラー" }, { status: 500 });
    }
}
