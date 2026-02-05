import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { sendEmail } from "@/lib/gmail";

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);

        if (!session) {
            return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }

        const { to, subject, content, attachment } = await request.json();

        if (!to || !content) {
            return NextResponse.json(
                { error: "宛先と本文は必須です" },
                { status: 400 }
            );
        }

        await sendEmail(to, subject || "議事録のご送付", content, attachment);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Mail send error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "メールの送信に失敗しました" },
            { status: 500 }
        );
    }
}
