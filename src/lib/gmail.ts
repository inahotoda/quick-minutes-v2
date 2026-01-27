import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function getGmailClient() {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
        throw new Error("認証が必要です");
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: session.accessToken as string });

    return google.gmail({ version: "v1", auth });
}

export async function sendEmail(to: string, subject: string, content: string) {
    const gmail = await getGmailClient();

    // メール本文をMIMEフォーマットに変換
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const messageParts = [
        `To: ${to}`,
        "Content-Type: text/plain; charset=utf-8",
        "MIME-Version: 1.0",
        `Subject: ${utf8Subject}`,
        "",
        content,
    ];
    const message = messageParts.join("\n");

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
