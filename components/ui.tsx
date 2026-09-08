import type { CSSProperties, ReactNode } from "react";

export const BLOCK_LABEL: Record<string, string> = {
  drill: "ドリル", writing_check: "英作文チェック", oral_quiz: "口頭試問",
  reading: "読解", review: "復習",
};

const BLOCK_TONE: Record<string, { bg: string; fg: string }> = {
  review: { bg: "var(--brand-100)", fg: "var(--brand-600)" },
  drill: { bg: "var(--brand-100)", fg: "var(--brand-600)" },
  reading: { bg: "var(--success-100)", fg: "var(--success-600)" },
  writing_check: { bg: "var(--warning-100)", fg: "var(--warning-600)" },
  oral_quiz: { bg: "var(--warning-100)", fg: "var(--warning-600)" },
};

export function Chip({ children, bg = "var(--ink-100)", fg = "var(--ink-700)" }: {
  children: ReactNode; bg?: string; fg?: string;
}) {
  return <span className="chip" style={{ background: bg, color: fg }}>{children}</span>;
}

export function BlockChip({ kind }: { kind: string }) {
  const tone = BLOCK_TONE[kind] ?? { bg: "var(--ink-100)", fg: "var(--ink-700)" };
  return <Chip bg={tone.bg} fg={tone.fg}>{BLOCK_LABEL[kind] ?? kind}</Chip>;
}

export function TopicDot({ token }: { token: string }) {
  return <span className="dot" style={{ background: `var(--${token.replace("/", "-")})` }} />;
}

export function StreakBadge({ days, alive }: { days: number; alive: boolean }) {
  const style: CSSProperties = {
    background: alive ? "var(--streak-100)" : "var(--ink-100)",
    color: alive ? "var(--streak-500)" : "var(--ink-500)",
    padding: "8px 12px", borderRadius: "var(--r-full)", fontSize: 16, fontWeight: 700,
    display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap",
  };
  return <span style={style}>🔥 {days}日</span>;
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <i style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
