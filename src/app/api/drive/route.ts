import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { findFolderByName, createFolder, uploadMarkdownAsDoc, uploadFile } from "@/lib/drive";

export async function POST(request: NextRequest) {
    return NextResponse.json(
        { error: "ブラウザに古いプログラムが残っています。画面を「ハード再読み込み（MacはCmd+Shift+R、WinはCtrl+F5）」してから再度お試しください。ボタン名に(V2)と付いていれば最新版です。" },
        { status: 410 }
    );
}
