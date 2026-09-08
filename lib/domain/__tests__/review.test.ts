import { describe, it, expect } from "vitest";
import {
  INTERVALS, addDays, daysBetween, initialReviewState, onReview, isMastered, isDue,
  reviewWeight, pickWeighted,
} from "../review";

describe("addDays / daysBetween", () => {
  it("月をまたいでも正しく進む", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("うるう日を跨げる", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("差分を日数で返す", () => {
    expect(daysBetween("2026-09-01", "2026-09-08")).toBe(7);
    expect(daysBetween("2026-09-08", "2026-09-01")).toBe(-7);
  });
});

describe("onReview", () => {
  const today = "2026-09-08";

  it("新規は翌日が初回", () => {
    expect(initialReviewState(today)).toEqual({
      intervalStep: 0, dueOn: "2026-09-09", consecutiveCorrect: 0,
    });
  });

  it("正解のたびに 1→3→7→16→35 と伸びる", () => {
    let s = initialReviewState(today);
    const got: number[] = [];
    for (let i = 0; i < INTERVALS.length; i++) {
      s = onReview(s, true, today);
      got.push(daysBetween(today, s.dueOn));
    }
    expect(got).toEqual([3, 7, 16, 35, 35]); // 最終段で頭打ち
  });

  it("誤答で間隔がリセットされ翌日に戻る", () => {
    let s = initialReviewState(today);
    s = onReview(s, true, today);
    s = onReview(s, true, today);
    expect(s.intervalStep).toBe(2);
    s = onReview(s, false, today);
    expect(s).toEqual({ intervalStep: 0, dueOn: "2026-09-09", consecutiveCorrect: 0 });
  });

  it("最終間隔に到達した時点で卒業する（連続4回正解）", () => {
    let s = initialReviewState(today);
    for (let i = 0; i < INTERVALS.length - 1; i++) {
      expect(isMastered(s)).toBe(false);
      s = onReview(s, true, today);
    }
    expect(s.intervalStep).toBe(INTERVALS.length - 1);
    expect(s.consecutiveCorrect).toBe(4);
    expect(isMastered(s)).toBe(true);
  });

  it("途中で誤答すると卒業が遠のく", () => {
    let s = initialReviewState(today);
    s = onReview(s, true, today);
    s = onReview(s, true, today);
    s = onReview(s, false, today);   // ここでリセット
    for (let i = 0; i < 3; i++) s = onReview(s, true, today);
    expect(isMastered(s)).toBe(false); // step3 まで戻っている
    s = onReview(s, true, today);
    expect(isMastered(s)).toBe(true);
  });

  it("最終間隔でも連続正解が足りなければ卒業しない", () => {
    const s = { intervalStep: 4, dueOn: "2026-10-13", consecutiveCorrect: 2 };
    expect(isMastered(s)).toBe(false);
  });
});

describe("isDue", () => {
  it("期限日当日と過ぎた分を対象にする", () => {
    expect(isDue({ dueOn: "2026-09-08" }, "2026-09-08")).toBe(true);
    expect(isDue({ dueOn: "2026-09-01" }, "2026-09-08")).toBe(true);
    expect(isDue({ dueOn: "2026-09-09" }, "2026-09-08")).toBe(false);
  });
});

describe("reviewWeight", () => {
  it("再発回数が多いほど重い", () => {
    const a = reviewWeight({ occurrenceCount: 3, dueOn: "2026-09-08" }, "2026-09-08");
    const b = reviewWeight({ occurrenceCount: 1, dueOn: "2026-09-08" }, "2026-09-08");
    expect(a).toBeGreaterThan(b);
  });
  it("期限を過ぎているほど重い", () => {
    const overdue = reviewWeight({ occurrenceCount: 1, dueOn: "2026-09-01" }, "2026-09-08");
    const onTime = reviewWeight({ occurrenceCount: 1, dueOn: "2026-09-08" }, "2026-09-08");
    expect(overdue).toBe(onTime + 7);
  });
  it("未来日の弱点は overdue 分で減点されない", () => {
    expect(reviewWeight({ occurrenceCount: 1, dueOn: "2026-09-20" }, "2026-09-08")).toBe(3);
  });
});

describe("pickWeighted", () => {
  const today = "2026-09-08";
  const items = [
    { id: "a", occurrenceCount: 1, dueOn: today },
    { id: "b", occurrenceCount: 5, dueOn: today },
    { id: "c", occurrenceCount: 1, dueOn: today },
  ];

  it("重複せず指定数を返す", () => {
    const picked = pickWeighted(items, today, 2, () => 0.5);
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((p) => p.id)).size).toBe(2);
  });

  it("候補が足りなければあるだけ返す", () => {
    expect(pickWeighted(items, today, 10, () => 0.1)).toHaveLength(3);
  });

  it("空でも落ちない", () => {
    expect(pickWeighted([], today, 3)).toEqual([]);
  });

  it("重い候補ほど選ばれやすい", () => {
    let seed = 1;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 2000; i++) counts[pickWeighted(items, today, 1, rand)[0].id]++;
    expect(counts.b).toBeGreaterThan(counts.a);
    expect(counts.b).toBeGreaterThan(counts.c);
  });
});
