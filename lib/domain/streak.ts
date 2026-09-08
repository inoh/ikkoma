/**
 * ストリーク更新。日付単位で冪等（同じ日に複数回セッションを終えても増えない）。
 * docs/04-data-model.md「streak 更新ルール」に対応。
 */
import { addDays } from "./review";

export type StreakSnapshot = {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
  lastStudiedOn: string | null;
};

export function applyStudyDay(s: StreakSnapshot, today: string): StreakSnapshot {
  if (s.lastStudiedOn === today) return s; // 冪等

  const continued = s.lastStudiedOn !== null && addDays(s.lastStudiedOn, 1) === today;
  const currentStreak = continued ? s.currentStreak + 1 : 1;

  return {
    currentStreak,
    longestStreak: Math.max(s.longestStreak, currentStreak),
    totalDays: s.totalDays + 1,
    lastStudiedOn: today,
  };
}

/** 表示用: 今日まだ実施していない場合でも、昨日やっていればストリークは生きている */
export function isStreakAlive(s: StreakSnapshot, today: string): boolean {
  if (!s.lastStudiedOn) return false;
  return s.lastStudiedOn === today || addDays(s.lastStudiedOn, 1) === today;
}
