import { describe, it, expect } from "vitest";
import { applyStudyDay, isStreakAlive, type StreakSnapshot } from "../streak";

const zero: StreakSnapshot = { currentStreak: 0, longestStreak: 0, totalDays: 0, lastStudiedOn: null };

describe("applyStudyDay", () => {
  it("初日は 1 になる", () => {
    expect(applyStudyDay(zero, "2026-09-08")).toEqual({
      currentStreak: 1, longestStreak: 1, totalDays: 1, lastStudiedOn: "2026-09-08",
    });
  });

  it("連続した翌日は +1", () => {
    const s = applyStudyDay(zero, "2026-09-08");
    expect(applyStudyDay(s, "2026-09-09").currentStreak).toBe(2);
  });

  it("同じ日に2回呼んでも増えない（冪等）", () => {
    const s = applyStudyDay(zero, "2026-09-08");
    expect(applyStudyDay(s, "2026-09-08")).toEqual(s);
  });

  it("1日空いたら 1 にリセットされる", () => {
    let s = applyStudyDay(zero, "2026-09-08");
    s = applyStudyDay(s, "2026-09-09");
    const after = applyStudyDay(s, "2026-09-11");
    expect(after.currentStreak).toBe(1);
  });

  it("リセットされても最長記録は保持される", () => {
    let s = applyStudyDay(zero, "2026-09-01");
    for (const d of ["2026-09-02", "2026-09-03", "2026-09-04"]) s = applyStudyDay(s, d);
    expect(s.longestStreak).toBe(4);
    const after = applyStudyDay(s, "2026-09-20");
    expect(after.currentStreak).toBe(1);
    expect(after.longestStreak).toBe(4);
    expect(after.totalDays).toBe(5);
  });

  it("月をまたいだ連続を切らさない", () => {
    const s = applyStudyDay(zero, "2026-09-30");
    expect(applyStudyDay(s, "2026-10-01").currentStreak).toBe(2);
  });
});

describe("isStreakAlive", () => {
  it("今日やっていれば生きている", () => {
    expect(isStreakAlive({ ...zero, lastStudiedOn: "2026-09-08" }, "2026-09-08")).toBe(true);
  });
  it("昨日までなら今日やれば繋がるので生きている", () => {
    expect(isStreakAlive({ ...zero, lastStudiedOn: "2026-09-07" }, "2026-09-08")).toBe(true);
  });
  it("2日空いたら切れている", () => {
    expect(isStreakAlive({ ...zero, lastStudiedOn: "2026-09-06" }, "2026-09-08")).toBe(false);
  });
  it("一度もやっていなければ切れている", () => {
    expect(isStreakAlive(zero, "2026-09-08")).toBe(false);
  });
});
