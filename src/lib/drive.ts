import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export async function getGoogleDriveClient() {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
        throw new Error("認証が必要です");
    }

    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials({ access_token: session.accessToken as string });

    return google.drive({ version: "v3", auth });
}

// フォルダを検索する
export async function findFolderByName(name: string, parentId?: string) {
    const drive = await getGoogleDriveClient();
    const q = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId || "root"}' in parents and trashed = false`;

    const response = await drive.files.list({
        q,
        fields: "files(id, name)",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    return response.data.files && response.data.files.length > 0 ? response.data.files[0] : null;
}

// ファイルを検索する
export async function findFileByName(name: string, parentId?: string) {
    const drive = await getGoogleDriveClient();
    const q = `name = '${name}' and '${parentId || "root"}' in parents and trashed = false`;

    const response = await drive.files.list({
        q,
        fields: "files(id, name)",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    return response.data.files && response.data.files.length > 0 ? response.data.files[0] : null;
}

export async function createFolder(name: string, parentId?: string) {
    const drive = await getGoogleDriveClient();

    const folderMetadata = {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : undefined,
    };

    const response = await drive.files.create({
        requestBody: folderMetadata,
        fields: "id, name, webViewLink",
        supportsAllDrives: true,
    });

    return response.data;
}

export async function uploadMarkdownAsDoc(
    name: string,
    markdown: string,
    folderId?: string
) {
    const drive = await getGoogleDriveClient();

    const fileMetadata = {
        name,
        mimeType: "application/vnd.google-apps.document",
        parents: folderId ? [folderId] : undefined,
    };

    const response = await drive.files.create({
        requestBody: fileMetadata,
        media: {
            mimeType: "text/plain",
            body: markdown,
        },
        fields: "id, name, webViewLink",
        supportsAllDrives: true,
    });

    return response.data;
}

export async function uploadFile(
    name: string,
    base64Content: string,
    mimeType: string,
    folderId?: string
) {
    const drive = await getGoogleDriveClient();

    const fileMetadata = {
        name,
        parents: folderId ? [folderId] : undefined,
    };

    // Base64からBufferに変換
    const buffer = Buffer.from(base64Content, "base64");
    const { Readable } = require("stream");
    const media = {
        mimeType,
        body: Readable.from(buffer),
    };

    const response = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: "id, name, webViewLink",
        supportsAllDrives: true,
    });

    return response.data;
}

export async function getFileContent(fileId: string) {
    const drive = await getGoogleDriveClient();
    const response = await drive.files.get({
        fileId,
        alt: "media",
        supportsAllDrives: true,
    });
    return response.data;
}

export async function updateFile(
    fileId: string,
    content: string,
    mimeType: string
) {
    const drive = await getGoogleDriveClient();
    const { Readable } = require("stream");

    const response = await drive.files.update({
        fileId,
        media: {
            mimeType,
            body: Readable.from(content),
        },
        fields: "id, name, webViewLink",
        supportsAllDrives: true,
    });

    return response.data;
}
