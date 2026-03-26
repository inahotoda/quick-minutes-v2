export type MeetingMode = "internal" | "business" | "other";

export interface UploadedFile {
    id: string;
    name: string;
    type: "audio" | "pdf" | "image";
    file: File;
}

// Next Action Bridge
export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskStatus = "pending" | "approved" | "edited" | "skipped" | "delivered" | "failed";

export interface ExtractedTask {
    id: string;
    assignee: string | null;
    assignee_confidence: number;
    action_summary: string;
    action_context: string | null;
    source_text: string;
    deadline_raw: string | null;
    deadline_date: string | null;
    deadline_confidence: number;
    priority: TaskPriority;
    recommended_channels: Array<{ type: string; reason: string }>;
    status: TaskStatus;
}

export interface TaskExtractionResult {
    tasks: ExtractedTask[];
    batchId: string;
    summary: {
        total: number;
        by_assignee: Record<string, number>;
    };
}
