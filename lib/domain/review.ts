/**
 * 間隔反復エンジン。
 * AI ではなく決定的なロジックで実装する（再現性とテスト可能性が要るため）。
 * docs/06-architecture.md「間隔反復エンジン」に対応。
 */

export const INTERVALS = [1, 3, 7, 16, 35] as const;
export const MASTERY_CONSECUTIVE_CORRECT = 3;

export type ReviewSnapshot = {
  intervalStep: number;
  dueOn: string; // YYYY-MM-DD
  consecutiveCorrect: number;
};

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** 新しく抽出された型の初期状態。翌日に最初の復習が来る */
export function initialReviewState(today: string): ReviewSnapshot {
  return { intervalStep: 0, dueOn: addDays(today, INTERVALS[0]), consecutiveCorrect: 0 };
}

/**
 * 復習の結果を反映する。
 * 正解: 次の間隔へ / 誤答: 間隔をリセットして翌日に戻す
 */
export function onReview(state: ReviewSnapshot, correct: boolean, today: string): ReviewSnapshot {
  if (!correct) {
    return { intervalStep: 0, dueOn: addDays(today, INTERVALS[0]), consecutiveCorrect: 0 };
  }
  const step = Math.min(state.intervalStep + 1, INTERVALS.length - 1);
  return {
    intervalStep: step,
    dueOn: addDays(today, INTERVALS[step]),
    consecutiveCorrect: state.consecutiveCorrect + 1,
  };
}

/** 最終間隔に到達し、かつ規定回数連続正解したら卒業 */
export function isMastered(state: ReviewSnapshot): boolean {
  return (
    state.intervalStep >= INTERVALS.length - 1 &&
    state.consecutiveCorrect >= MASTERY_CONSECUTIVE_CORRECT
  );
}

export function isDue(state: Pick<ReviewSnapshot, "dueOn">, today: string): boolean {
  return state.dueOn <= today;
}

/**
 * 出題の重み付け。再発回数が多いほど、期限を過ぎているほど出やすい。
 * docs/06-architecture.md の weight(type) と同じ式。
 */
export function reviewWeight(
  input: { occurrenceCount: number; dueOn: string },
  today: string,
): number {
  const overdue = Math.max(0, daysBetween(input.dueOn, today));
  return input.occurrenceCount * 2 + overdue + 1;
}

/** 重み付き抽選。rand は [0,1) を返す関数（テストで差し替える） */
export function pickWeighted<T extends { occurrenceCount: number; dueOn: string }>(
  candidates: T[],
  today: string,
  count: number,
  rand: () => number = Math.random,
): T[] {
  const pool = [...candidates];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const weights = pool.map((c) => reviewWeight(c, today));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r < 0) { idx = i; break; }
    }
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}
