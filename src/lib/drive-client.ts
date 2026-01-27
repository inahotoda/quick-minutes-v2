/**
 * ブラウザから直接Google Drive APIを叩くためのユーティリティ
 * Vercelの4.5MB制限を回避するために使用
 */

export async function findFolderByName(name: string, parentId: string, accessToken: string) {
    const q = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id, name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0] : null;
}

export async function createFolder(name: string, parentId: string, accessToken: string) {
    const url = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true";
    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentId]
        })
    });
    return await response.json();
}

export async function uploadMarkdownAsDoc(name: string, content: string, folderId: string, accessToken: string) {
    // 小さいファイルでもResumableを使っても良いが、こちらはシンプルに
    const metadata = {
        name,
        mimeType: "application/vnd.google-apps.document",
        parents: [folderId]
    };

    const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";

    // multipart/related を手動で構成するのは少し面倒なので、再度 FormData を試す。
    // もし Google が multipart/form-data を拒否する場合は、resumable 方式に倒す。
    // 安全のため、ここも resumable に統一
    return await resumableUpload(name, new Blob([content], { type: "text/plain" }), folderId, accessToken, "application/vnd.google-apps.document");
}

export async function uploadAudioFile(name: string, blob: Blob, folderId: string, accessToken: string) {
    return await resumableUpload(name, blob, folderId, accessToken, blob.type);
}

async function resumableUpload(name: string, blob: Blob, folderId: string, accessToken: string, mimeType: string) {
    // 1. セッションの開始
    const metadata = {
        name,
        parents: [folderId],
        mimeType: mimeType // metadata 側でも指定（Doc化したい場合はここで指定）
    };

    const initUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true";
    const initResponse = await fetch(initUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(metadata)
    });

    if (!initResponse.ok) {
        throw new Error(`Upload Init Failed: ${initResponse.statusText}`);
    }

    const uploadUrl = initResponse.headers.get("Location");
    if (!uploadUrl) {
        throw new Error("Upload URL not received");
    }

    // 2. 実際のデータをアップロード
    const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
            "Content-Type": blob.type || "application/octet-stream"
        },
        body: blob
    });

    if (!uploadResponse.ok) {
        throw new Error(`Upload Data Failed: ${uploadResponse.statusText}`);
    }

    return await uploadResponse.json();
}
