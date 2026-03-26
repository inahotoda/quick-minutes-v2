/**
 * Gemini が出力するネクストアクション表（マークダウンテーブル）をパースして
 * ExtractedTask[] に変換するパーサー
 *
 * Sonnet による再抽出を廃止し、Gemini 出力をそのまま構造化する
 */

import { ExtractedTask, TaskPriority } from "@/types";

interface ParseOptions {
    meetingDate?: string;       // YYYY-MM-DD
    participants?: string[];    // 参加者リスト（担当者の照合用）
}

/**
 * 議事録マークダウンからネクストアクション表をパースして ExtractedTask[] を返す
 */
export function parseNextActions(
    minutesMarkdown: string,
    options: ParseOptions = {}
): ExtractedTask[] {
    const { meetingDate, participants = [] } = options;
    const baseDate = meetingDate ? new Date(meetingDate) : new Date();

    // ネクストアクションセクションを検出
    const sectionText = extractNextActionSection(minutesMarkdown);
    if (!sectionText) return [];

    // テーブル行をパース
    const rows = parseTableRows(sectionText);
    if (rows.length === 0) return [];

    // ExtractedTask[] に変換
    return rows.map((row, idx) => {
        const deadlineResult = resolveDeadline(row.deadline, baseDate);
        const priority = row.priority
            ? normalizePriority(row.priority)
            : inferPriority(deadlineResult.date, row.notes, baseDate);
        const assigneeConfidence = computeAssigneeConfidence(row.assignee, participants);
        const channels = inferChannels(deadlineResult.date, row.assignee, participants);

        return {
            id: `parsed-${Date.now()}-${idx}`,
            assignee: row.assignee || null,
            assignee_confidence: assigneeConfidence,
            action_summary: row.action,
            action_context: row.notes || null,
            source_text: row.action, // パーサー由来なのでアクション内容をそのまま
            deadline_raw: row.deadline || null,
            deadline_date: deadlineResult.date,
            deadline_confidence: deadlineResult.confidence,
            priority,
            recommended_channels: channels,
            status: "pending",
        };
    });
}

// =====================================================
// セクション検出
// =====================================================

function extractNextActionSection(md: string): string | null {
    // 「ネクストアクション」「Next Action」セクションを検出
    // 見出し例: "## 🎯 ネクストアクション", "## ▼ 02. ネクストアクション", "## 02. ネクストアクション"
    // .*? で見出し内の任意のプレフィックス（番号、絵文字等）を許容
    const patterns = [
        /(?:^|\n)#{1,3}\s+.*?ネクストアクション[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n---|\n\*\*\*|$)/i,
        /(?:^|\n)#{1,3}\s+.*?Next\s*Action[s]?[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n---|\n\*\*\*|$)/i,
        /(?:^|\n)#{1,3}\s+.*?アクションアイテム[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n---|\n\*\*\*|$)/i,
    ];

    for (const pattern of patterns) {
        const match = md.match(pattern);
        if (match?.[1]?.trim()) return match[1];
    }

    return null;
}

// =====================================================
// テーブルパース
// =====================================================

interface TableRow {
    id: string;
    action: string;
    assignee: string;
    deadline: string;
    priority: string;
    notes: string;
}

function parseTableRows(sectionText: string): TableRow[] {
    const lines = sectionText.split("\n").map(l => l.trim()).filter(Boolean);

    // ヘッダー行を探す
    const headerIdx = lines.findIndex(l =>
        l.startsWith("|") && /アクション|内容|タスク/i.test(l)
    );
    if (headerIdx === -1) return [];

    // ヘッダーからカラムマッピングを作成
    const headerCells = splitTableRow(lines[headerIdx]);
    const colMap = mapColumns(headerCells);

    // セパレータ行（|:---|...）をスキップ
    let dataStart = headerIdx + 1;
    if (dataStart < lines.length && /^\|[\s:*-]+\|/.test(lines[dataStart])) {
        dataStart++;
    }

    const rows: TableRow[] = [];
    for (let i = dataStart; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith("|")) break; // テーブル外に出たら終了

        const cells = splitTableRow(line);
        if (cells.length < 2) continue;

        const action = getCell(cells, colMap.action);
        if (!action) continue; // アクション内容が空ならスキップ

        rows.push({
            id: getCell(cells, colMap.id),
            action,
            assignee: getCell(cells, colMap.assignee),
            deadline: getCell(cells, colMap.deadline),
            priority: getCell(cells, colMap.priority),
            notes: getCell(cells, colMap.notes),
        });
    }

    return rows;
}

function splitTableRow(line: string): string[] {
    // 先頭・末尾の | を除去してセル分割
    return line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(cell => cell.trim());
}

interface ColumnMap {
    id: number;
    action: number;
    assignee: number;
    deadline: number;
    priority: number;
    notes: number;
}

function mapColumns(headers: string[]): ColumnMap {
    const map: ColumnMap = { id: -1, action: -1, assignee: -1, deadline: -1, priority: -1, notes: -1 };

    headers.forEach((h, i) => {
        const lower = h.toLowerCase();
        if (/^id$|^no$|^#$|^番号/.test(lower)) map.id = i;
        else if (/アクション|内容|タスク|action/i.test(h)) map.action = i;
        else if (/担当|assignee/i.test(h)) map.assignee = i;
        else if (/期限|deadline|日時|due/i.test(h)) map.deadline = i;
        else if (/優先|priority/i.test(h)) map.priority = i;
        else if (/備考|メモ|note|comment|コメント/i.test(h)) map.notes = i;
    });

    // アクション列が見つからない場合、ID の次（= 2番目）をアクションとみなす
    if (map.action === -1 && headers.length >= 2) {
        map.action = map.id === 0 ? 1 : 0;
    }

    return map;
}

function getCell(cells: string[], idx: number): string {
    if (idx < 0 || idx >= cells.length) return "";
    return cells[idx].trim();
}

// =====================================================
// 期限の解決
// =====================================================

interface DeadlineResult {
    date: string | null;    // YYYY-MM-DD
    confidence: number;
}

function resolveDeadline(raw: string, baseDate: Date): DeadlineResult {
    if (!raw || raw === "-" || raw === "なし" || raw === "期限未定" || raw === "未定") {
        return { date: null, confidence: 0 };
    }

    // YYYY-MM-DD or YYYY年MM月DD日 形式
    const isoMatch = raw.match(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})/);
    if (isoMatch) {
        const y = isoMatch[1];
        const m = isoMatch[2].padStart(2, "0");
        const d = isoMatch[3].padStart(2, "0");
        return { date: `${y}-${m}-${d}`, confidence: 0.95 };
    }

    // MM月DD日 形式（年なし）
    const mdMatch = raw.match(/(\d{1,2})月(\d{1,2})日/);
    if (mdMatch) {
        const m = mdMatch[1].padStart(2, "0");
        const d = mdMatch[2].padStart(2, "0");
        const y = baseDate.getFullYear();
        return { date: `${y}-${m}-${d}`, confidence: 0.85 };
    }

    // 相対表現
    const relDate = resolveRelativeDate(raw, baseDate);
    if (relDate) return relDate;

    return { date: null, confidence: 0.3 };
}

function resolveRelativeDate(raw: string, baseDate: Date): DeadlineResult | null {
    const d = new Date(baseDate);

    if (/今日|本日/.test(raw)) {
        return { date: formatDate(d), confidence: 0.9 };
    }
    if (/明日/.test(raw)) {
        d.setDate(d.getDate() + 1);
        return { date: formatDate(d), confidence: 0.9 };
    }
    if (/明後日/.test(raw)) {
        d.setDate(d.getDate() + 2);
        return { date: formatDate(d), confidence: 0.9 };
    }
    if (/今週中|今週末/.test(raw)) {
        // 今週の金曜日
        const dayOfWeek = d.getDay();
        const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
        d.setDate(d.getDate() + daysUntilFriday);
        return { date: formatDate(d), confidence: 0.7 };
    }
    if (/来週|来週中/.test(raw)) {
        // 来週の金曜日
        const dayOfWeek = d.getDay();
        const daysUntilNextFriday = (5 - dayOfWeek + 7) % 7 + 7;
        d.setDate(d.getDate() + daysUntilNextFriday);
        return { date: formatDate(d), confidence: 0.6 };
    }
    if (/来週末/.test(raw)) {
        const dayOfWeek = d.getDay();
        const daysUntilNextFriday = (5 - dayOfWeek + 7) % 7 + 7;
        d.setDate(d.getDate() + daysUntilNextFriday);
        return { date: formatDate(d), confidence: 0.6 };
    }
    if (/来月|来月中/.test(raw)) {
        d.setMonth(d.getMonth() + 1);
        // 月末
        d.setDate(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
        return { date: formatDate(d), confidence: 0.5 };
    }

    // 「X日以内」「X日後」
    const daysMatch = raw.match(/(\d+)\s*日\s*(以内|後|中)/);
    if (daysMatch) {
        d.setDate(d.getDate() + parseInt(daysMatch[1]));
        return { date: formatDate(d), confidence: 0.7 };
    }

    // 「X週間以内」「X週間後」
    const weeksMatch = raw.match(/(\d+)\s*週間?\s*(以内|後|中)/);
    if (weeksMatch) {
        d.setDate(d.getDate() + parseInt(weeksMatch[1]) * 7);
        return { date: formatDate(d), confidence: 0.6 };
    }

    // 「なるべく早く」「ASAP」
    if (/なるべく早|至急|ASAP|早急|緊急/i.test(raw)) {
        d.setDate(d.getDate() + 2);
        return { date: formatDate(d), confidence: 0.5 };
    }

    // 「次回MTGまで」「次回まで」
    if (/次回|次のMTG|次の会議/i.test(raw)) {
        d.setDate(d.getDate() + 7);
        return { date: formatDate(d), confidence: 0.4 };
    }

    return null;
}

function formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// =====================================================
// 優先度判定
// =====================================================

function normalizePriority(raw: string): TaskPriority {
    const lower = raw.toLowerCase().trim();
    if (/critical|緊急|最優先/.test(lower)) return "critical";
    if (/high|高/.test(lower)) return "high";
    if (/medium|中/.test(lower)) return "medium";
    if (/low|低/.test(lower)) return "low";
    return "medium";
}

function inferPriority(
    deadlineDate: string | null,
    notes: string,
    baseDate: Date
): TaskPriority {
    // 期限ベースの推定
    if (deadlineDate) {
        const deadline = new Date(deadlineDate);
        const daysUntil = (deadline.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysUntil <= 1) return "critical";
        if (daysUntil <= 3) return "high";
        if (daysUntil <= 14) return "medium";
    }

    // 備考に緊急性を示すキーワード
    if (notes && /緊急|至急|ブロック|ブロッカー|critical/i.test(notes)) return "critical";
    if (notes && /重要|急ぎ|優先/i.test(notes)) return "high";

    return deadlineDate ? "medium" : "low";
}

// =====================================================
// 担当者 confidence
// =====================================================

function computeAssigneeConfidence(assignee: string, participants: string[]): number {
    if (!assignee || assignee === "要確認" || assignee === "未定") return 0.3;

    // 完全一致
    if (participants.some(p => p === assignee)) return 0.95;

    // 部分一致（名字だけ etc.）
    if (participants.some(p => p.includes(assignee) || assignee.includes(p))) return 0.8;

    // 参加者リストにないが名前がある
    return 0.5;
}

// =====================================================
// チャネル推奨
// =====================================================

function inferChannels(
    deadlineDate: string | null,
    assignee: string,
    participants: string[]
): Array<{ type: string; reason: string }> {
    const channels: Array<{ type: string; reason: string }> = [];

    if (deadlineDate) {
        channels.push({
            type: "google_calendar",
            reason: "期限付きタスクのため Calendar に登録推奨",
        });
    }

    if (assignee && assignee !== "要確認" && assignee !== "未定") {
        channels.push({
            type: "google_chat",
            reason: "担当者への通知推奨",
        });
    }

    if (channels.length === 0) {
        channels.push({
            type: "google_calendar",
            reason: "タスク管理のため Calendar 登録推奨",
        });
    }

    return channels;
}
