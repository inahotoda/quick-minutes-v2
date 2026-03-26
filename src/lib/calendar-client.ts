/**
 * ブラウザから直接 Google Calendar API を叩くユーティリティ
 * drive-client.ts と同じパターン（accessToken をセッションから受け取る）
 */

export interface CalendarEventParams {
    summary: string;
    description?: string;
    date: string;       // YYYY-MM-DD（終日イベント）
    timeZone?: string;
    attendeeEmail?: string; // 担当者のメールアドレス（招待用）
}

export interface CalendarEventResult {
    success: boolean;
    eventId?: string;
    htmlLink?: string;
    error?: string;
}

/**
 * Google Calendar に終日イベントを作成
 */
export async function createCalendarEvent(
    accessToken: string,
    params: CalendarEventParams
): Promise<CalendarEventResult> {
    const { summary, description, date, timeZone, attendeeEmail } = params;

    // 終日イベント: start.date / end.date（翌日）
    const startDate = date;
    const endParts = date.split("-").map(Number);
    const endDateObj = new Date(endParts[0], endParts[1] - 1, endParts[2] + 1);
    const endDate = endDateObj.toISOString().split("T")[0];

    const body: Record<string, unknown> = {
        summary,
        description: description || "",
        start: {
            date: startDate,
            timeZone: timeZone || "Asia/Tokyo",
        },
        end: {
            date: endDate,
            timeZone: timeZone || "Asia/Tokyo",
        },
    };

    // 担当者のメールアドレスがあれば招待
    if (attendeeEmail) {
        body.attendees = [{ email: attendeeEmail }];
    }

    try {
        const response = await fetch(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMsg = errorData?.error?.message || `HTTP ${response.status}`;
            return { success: false, error: errorMsg };
        }

        const data = await response.json();
        return {
            success: true,
            eventId: data.id,
            htmlLink: data.htmlLink,
        };
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : "Calendar API エラー",
        };
    }
}
