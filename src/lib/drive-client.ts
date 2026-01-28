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
    const blob = new Blob([content], { type: "text/plain" });
    // 保存時は Google Doc、送るデータは text/plain
    return await resumableUpload(name, blob, folderId, accessToken, "application/vnd.google-apps.document", "text/plain");
}

export async function uploadFile(name: string, blob: Blob, folderId: string, accessToken: string) {
    // 保存時も送るデータも同じ（audio/mp4, application/pdf 等）
    const mime = blob.type || "application/octet-stream";
    return await resumableUpload(name, blob, folderId, accessToken, mime, mime);
}

async function resumableUpload(
    name: string,
    blob: Blob,
    folderId: string,
    accessToken: string,
    targetMimeType: string,
    contentMimeType: string
) {
    // 1. セッションの開始 (POST)
    const metadata = {
        name,
        parents: [folderId],
        mimeType: targetMimeType
    };

    const initUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true";
    let initResponse;
    try {
        initResponse = await fetch(initUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "X-Upload-Content-Type": contentMimeType
            },
            body: JSON.stringify(metadata)
        });
    } catch (e: any) {
        throw new Error(`Init Network Error: ${e.message}`);
    }

    if (!initResponse.ok) {
        const errText = await initResponse.text().catch(() => "");
        throw new Error(`Upload Init Failed (${initResponse.status}): ${initResponse.statusText}. ${errText}`);
    }

    const uploadUrl = initResponse.headers.get("Location");
    if (!uploadUrl) {
        throw new Error("Upload URL (Location) not found");
    }

    // 2. データのアップロード (PUT)
    console.log(`Resumable: Uploading ${name} (${blob.size} bytes)...`);
    let uploadResponse;
    try {
        uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
                "Content-Type": contentMimeType
            },
            body: blob
        });
    } catch (e: any) {
        throw new Error(`Data Upload Network Error: ${e.message}`);
    }

    if (!uploadResponse.ok) {
        const errText = await uploadResponse.text().catch(() => "");
        throw new Error(`Upload Data Failed (${uploadResponse.status}): ${uploadResponse.statusText}. ${errText}`);
    }

    return await uploadResponse.json();
}
