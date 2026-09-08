import { describe, it, expect } from "vitest";
import { validateMenu, todayInTz, weekdayOf, type DraftMenuItem } from "../menu";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const known = [T1, T2];

const good: DraftMenuItem[] = [
  { topicId: T1, blockKind: "review", minutes: 5, title: "昨日の弱点3型を再テスト",
    instruction: "冠詞の付け忘れ・副詞の語順・複合名詞について、各2問ずつ計6問を出題して答える" },
  { topicId: T2, blockKind: "reading", minutes: 20, title: "Runtime の公式ドキュメントを読む",
    instruction: "AgentCore Runtime の概要ページを読み、なぜ Lambda ではないのかを1段落で説明する" },
  { topicId: T2, blockKind: "oral_quiz", minutes: 5, title: "主要6コンポーネントの役割を答える",
    instruction: "Runtime / Gateway / Memory / Identity / Observability / Built-in Tools を1つずつ口頭で説明する" },
];

describe("validateMenu", () => {
  it("良いメニューは通る", () => {
    expect(validateMenu(good, 30, known)).toEqual([]);
  });

  it("空のメニューを弾く", () => {
    const issues = validateMenu([], 30, known);
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("items");
  });

  it("「勉強する」のような曖昧なタイトルを弾く", () => {
    const items = [{ ...good[0], title: "勉強する" }, good[1], good[2]];
    expect(validateMenu(items, 30, known).some((i) => i.field === "title")).toBe(true);
  });

  it("instruction が短すぎるものを弾く", () => {
    const items = [{ ...good[0], instruction: "ドリルをやる" }, good[1], good[2]];
    const issues = validateMenu(items, 30, known);
    expect(issues.some((i) => i.field === "instruction")).toBe(true);
  });

  it("完了条件が読み取れない instruction を弾く", () => {
    const items = [
      { ...good[0], instruction: "前置詞についてなんとなく理解を深めていきたいところです" },
      good[1], good[2],
    ];
    const issues = validateMenu(items, 30, known);
    expect(issues.some((i) => i.field === "instruction" && i.message.includes("完了条件"))).toBe(true);
  });

  it("合計時間が目標から乖離したら弾く", () => {
    const items = [{ ...good[0], minutes: 30 }, good[1], good[2]];
    const issues = validateMenu(items, 30, known);
    expect(issues.some((i) => i.field === "totalMinutes")).toBe(true);
  });

  it("±5分は許容する", () => {
    const items = [{ ...good[0], minutes: 9 }, good[1], good[2]];
    expect(validateMenu(items, 30, known)).toEqual([]);
  });

  it("未知のトピックを弾く", () => {
    const items = [{ ...good[0], topicId: "99999999-9999-9999-9999-999999999999" }, good[1], good[2]];
    expect(validateMenu(items, 30, known).some((i) => i.field === "topicId")).toBe(true);
  });

  it("minutes が 0 や負の値を弾く", () => {
    expect(validateMenu([{ ...good[0], minutes: 0 }], 30, known).some((i) => i.field === "minutes")).toBe(true);
    expect(validateMenu([{ ...good[0], minutes: -5 }], 30, known).some((i) => i.field === "minutes")).toBe(true);
  });
});

describe("weekdayOf / todayInTz", () => {
  it("2026-09-08 は火曜(2)", () => {
    expect(weekdayOf("2026-09-08")).toBe(2);
  });
  it("UTC 深夜でも Asia/Tokyo では翌日になる", () => {
    const utcLateNight = new Date("2026-09-08T16:30:00Z");
    expect(todayInTz("Asia/Tokyo", utcLateNight)).toBe("2026-09-09");
    expect(todayInTz("UTC", utcLateNight)).toBe("2026-09-08");
  });
});
