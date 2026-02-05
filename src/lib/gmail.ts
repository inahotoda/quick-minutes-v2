import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function getGmailClient() {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
        throw new Error("認証が必要です");
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: session.accessToken as string });

    return google.gmail({ version: "v1", auth });
}

interface Attachment {
    filename: string;
    mimeType: string;
    data: string; // Base64 encoded
}

export async function sendEmail(to: string, subject: string, content: string, attachment?: Attachment) {
    const gmail = await getGmailClient();

    // Subject をUTF-8 Base64エンコード
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;

    let message: string;

    if (attachment) {
        // PDF添付付きメール（マルチパート）
        const boundary = "----=_Part_" + Date.now().toString(36);

        const messageParts = [
            `To: ${to}`,
            "MIME-Version: 1.0",
            `Subject: ${utf8Subject}`,
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
            "",
            `--${boundary}`,
            "Content-Type: text/html; charset=utf-8",
            "Content-Transfer-Encoding: base64",
            "",
            Buffer.from(content).toString("base64"),
            "",
            `--${boundary}`,
            `Content-Type: ${attachment.mimeType}`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="${attachment.filename}"`,
            "",
            attachment.data,
            "",
            `--${boundary}--`,
        ];
        message = messageParts.join("\r\n");
    } else {
        // テキストのみのメール
        const messageParts = [
            `To: ${to}`,
            "Content-Type: text/plain; charset=utf-8",
            "MIME-Version: 1.0",
            `Subject: ${utf8Subject}`,
            "",
            content,
        ];
        message = messageParts.join("\n");
    }

    // Base64url形式に変換
    const encodedMessage = Buffer.from(message)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    await gmail.users.messages.send({
        userId: "me",
        requestBody: {
            raw: encodedMessage,
        },
    });
}
