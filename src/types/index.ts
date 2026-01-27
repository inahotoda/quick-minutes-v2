export type MeetingMode = "internal" | "business" | "other";

export interface UploadedFile {
    id: string;
    name: string;
    type: "audio" | "pdf" | "image";
    file: File;
}
