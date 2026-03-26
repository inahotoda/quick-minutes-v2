"use client";

import { MemberType, MEMBER_TYPE_COLORS } from "@/lib/member-storage";

interface MemberAvatarProps {
    name: string;
    size?: "sm" | "md" | "lg";
    memberType?: MemberType;
    showTypeDot?: boolean;
}

// Generate a stable hash from a string
function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

// Get initials from name (first character for Japanese, first+last for Western)
function getInitials(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return "?";
    // Return first character (works for both Japanese and Western names)
    return trimmed.charAt(0);
}

// Generate gradient colors from name hash
function getGradientColors(name: string): [string, string] {
    const hash = hashString(name);
    const hue1 = hash % 360;
    const hue2 = (hue1 + 40 + (hash % 30)) % 360;
    return [
        `hsl(${hue1}, 70%, 55%)`,
        `hsl(${hue2}, 65%, 45%)`,
    ];
}

const SIZES = {
    sm: { container: 32, font: "0.8rem", dot: 10 },
    md: { container: 44, font: "1.1rem", dot: 12 },
    lg: { container: 56, font: "1.4rem", dot: 14 },
};

export default function MemberAvatar({ name, size = "md", memberType, showTypeDot = false }: MemberAvatarProps) {
    const [color1, color2] = getGradientColors(name);
    const initial = getInitials(name);
    const s = SIZES[size];
    const typeColor = memberType ? MEMBER_TYPE_COLORS[memberType] : null;

    return (
        <div
            style={{
                width: s.container,
                height: s.container,
                minWidth: s.container,
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${color1}, ${color2})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: s.font,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                position: "relative",
                boxShadow: `0 2px 8px ${color1}40`,
            }}
        >
            {initial}
            {showTypeDot && typeColor && (
                <div
                    style={{
                        position: "absolute",
                        bottom: -1,
                        right: -1,
                        width: s.dot,
                        height: s.dot,
                        borderRadius: "50%",
                        background: typeColor.text,
                        border: "2px solid #1a1a2e",
                    }}
                />
            )}
        </div>
    );
}

// Export utilities for use outside component
export { getInitials, getGradientColors, hashString };
