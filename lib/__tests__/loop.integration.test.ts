/**
 * コアループの統合テスト。
 * AI 呼び出しだけをスタブし、DB とサービス層は本物を通す。
 * 「提示 → 実施 → 記録 → 抽出 → 反復」が閉じていることを確認する。
 *
 *   DATABASE_URL=postgres://localhost:5432/ikkoma_test npx vitest run lib/__tests__
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const generateMenu = vi.fn();
const nextDrill = vi.fn();
const correct = vi.fn();
const completeSession = vi.fn();

vi.mock("@/lib/ai/menu", () => ({ generateMenu: (...a: unknown[]) => generateMenu(...a) }));
vi.mock("@/lib/ai/drill", () => ({ nextDrill: (...a: unknown[]) => nextDrill(...a) }));
vi.mock("@/lib/ai/correction", () => ({ correct: (...a: unknown[]) => correct(...a) }));
vi.mock("@/lib/ai/complete", () => ({ completeSession: (...a: unknown[]) => completeSession(...a) }));

const { db } = await import("@/lib/db");
const s = await import("@/lib/db/schema");
const { ensureMenu } = await import("@/lib/services/menu");
const { startSession, issueDrill, answerDrill, submitWriting, finishSession, summarize } =
  await import("@/lib/services/session");
const { approveWeakness, dueWeaknesses } = await import("@/lib/services/weakness");
const { INTERVALS, addDays } = await import("@/lib/domain/review");

const TODAY = "2026-09-08";
let userId: string;
let topicId: string;

beforeAll(() => {
  if (!/ikkoma_test/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("DATABASE_URL を ikkoma_test に向けてください（本番DBを壊さないため）");
  }
});

beforeEach(async () => {
  await db.delete(s.users);
  vi.clearAllMocks();

  const [u] = await db.insert(s.users)
    .values({ email: `t${Date.now()}@example.com`, dailyGoalMinutes: 30 }).returning();
  userId = u.id;

  const [t] = await db.insert(s.topics).values({
    userId, title: "TOEIC", goal: "600点取得",
    currentState: "推定300〜400点", nextActions: ["品詞ドリル10問"],
  }).returning();
  topicId = t.id;

  await db.insert(s.milestones).values({
    topicId, code: "M2", title: "基礎固め", orderIndex: 0,
  });
  await db.insert(s.topicMenuTemplates).values({
    topicId, blockKind: "drill", minutes: 30, instruction: "問題を10問出す", orderIndex: 0,
  });
});

function stubMenu() {
  generateMenu.mockResolvedValue({
    items: [{
      topicId, blockKind: "drill", minutes: 30,
      title: "品詞ドリル10問",
      instruction: "品詞の見分けを問う問題を10問出題し、1問ずつ解説する",
      reviewTypeIds: [],
    }],
    retried: false,
  });
}

describe("① 提示: メニュー生成", () => {
  it("生成したメニューが保存され、2回目はキャッシュが返る（AI を再度叩かない）", async () => {
    stubMenu();
    const first = await ensureMenu(userId, TODAY);
    expect(first?.items).toHaveLength(1);
    expect(first?.items[0].item.title).toBe("品詞ドリル10問");
    expect(generateMenu).toHaveBeenCalledTimes(1);

    const second = await ensureMenu(userId, TODAY);
    expect(second?.menu.id).toBe(first?.menu.id);
    expect(generateMenu).toHaveBeenCalledTimes(1); // キャッシュが効いている

    await ensureMenu(userId, TODAY, true); // force で作り直し
    expect(generateMenu).toHaveBeenCalledTimes(2);
  });

  it("active なトピックが無ければ生成しない", async () => {
    await db.update(s.topics).set({ status: "paused" }).where(eq(s.topics.id, topicId));
    expect(await ensureMenu(userId, TODAY)).toBeNull();
    expect(generateMenu).not.toHaveBeenCalled();
  });
});

describe("②〜⑤ 実施→記録→抽出→反復", () => {
  it("1セッションでログ・ストリーク・弱点の下書きがすべて確定する", async () => {
    stubMenu();
    const menu = await ensureMenu(userId, TODAY);
    const itemId = menu!.items[0].item.id;

    const session = await startSession(userId, itemId);
    expect(session.state).toBe("in_progress");

    // ② 実施: 出題 → 正解
    nextDrill.mockResolvedValue({
      question: "The report was reviewed ___.",
      choices: [{ key: "A", text: "careful" }, { key: "B", text: "carefully" }],
      correctAnswer: "B", explanation: "動詞を修飾するので副詞", targetTypeIds: [],
    });
    const attempt = await issueDrill(session.id, userId, TODAY);
    const answered = await answerDrill(attempt.id, "B", TODAY);
    expect(answered.attempt.isCorrect).toBe(true);

    // ② 実施: 添削
    correct.mockResolvedValue({
      correctedText: "I checked the email.", diff: [], feedback: "冠詞を落とさないこと",
      detectedTypes: [],
    });
    const w = await submitWriting(session.id, userId, "I checked mail.");
    expect(w.correction.correctedText).toBe("I checked the email.");

    // ③④ 記録と抽出
    completeSession.mockResolvedValue({
      summary: "品詞ドリル1問(1/1)+英作文1文添削",
      updatedCurrentState: "品詞は安定してきた",
      nextAction: "前置詞ドリル10問",
      detectedTypes: [{
        knownTypeId: null, label: "冠詞の付け忘れ", description: "単数可算名詞には限定詞が必須",
        exampleWrong: "checked mail", exampleRight: "checked the email",
      }],
    });
    const result = await finishSession(session.id, userId, TODAY);

    expect(result.session.state).toBe("completed");
    expect(result.session.summary).toBe("品詞ドリル1問(1/1)+英作文1文添削");
    expect(result.score).toEqual({ correct: 1, total: 1 });
    expect(result.streak?.currentStreak).toBe(1);
    expect(result.nextAction).toBe("前置詞ドリル10問");

    // 現在地が更新されている
    const [topic] = await db.select().from(s.topics).where(eq(s.topics.id, topicId));
    expect(topic.currentState).toBe("品詞は安定してきた");

    // メニュー項目が done になっている
    const [item] = await db.select().from(s.menuItems).where(eq(s.menuItems.id, itemId));
    expect(item.status).toBe("done");

    // 抽出された型は未承認の下書きで、まだ復習キューに入っていない
    expect(result.pendingTypes).toHaveLength(1);
    expect(result.pendingTypes[0].label).toBe("冠詞の付け忘れ");
    expect(result.pendingTypes[0].approved).toBe(false);
    expect(await dueWeaknesses(userId, TODAY)).toHaveLength(0);

    // ⑤ 反復: 承認して初めてキューに入る
    const typeId = result.pendingTypes[0].id;
    await approveWeakness(typeId, TODAY);
    const [rs] = await db.select().from(s.reviewState).where(eq(s.reviewState.typeId, typeId));
    expect(rs.dueOn).toBe(addDays(TODAY, INTERVALS[0]));
    expect(await dueWeaknesses(userId, addDays(TODAY, 1))).toHaveLength(1);
  });

  it("完了を二度呼んでもストリークは増えない（冪等）", async () => {
    stubMenu();
    const menu = await ensureMenu(userId, TODAY);
    const session = await startSession(userId, menu!.items[0].item.id);
    completeSession.mockResolvedValue({
      summary: "テスト", updatedCurrentState: null, nextAction: "次", detectedTypes: [],
    });

    await finishSession(session.id, userId, TODAY);
    const again = await finishSession(session.id, userId, TODAY);
    expect(again.streak?.currentStreak).toBe(1);
    expect(completeSession).toHaveBeenCalledTimes(1); // 完了済みなら AI を再度叩かない
  });

  it("中断したセッションは再開され、二重に作られない", async () => {
    stubMenu();
    const menu = await ensureMenu(userId, TODAY);
    const itemId = menu!.items[0].item.id;
    const a = await startSession(userId, itemId);
    const b = await startSession(userId, itemId);
    expect(b.id).toBe(a.id);
  });
});

describe("⑤ 反復: 間隔反復が正誤で動く", () => {
  async function seedApprovedWeakness(label: string) {
    const [w] = await db.insert(s.weaknessTypes).values({
      userId, topicId, label, description: "", approved: true, occurrenceCount: 1,
    }).returning();
    await db.insert(s.reviewState).values({ typeId: w.id, intervalStep: 0, dueOn: TODAY, consecutiveCorrect: 0 });
    return w.id;
  }

  it("正解で次の間隔へ進む", async () => {
    const typeId = await seedApprovedWeakness("冠詞の付け忘れ");
    stubMenu();
    const menu = await ensureMenu(userId, TODAY);
    const session = await startSession(userId, menu!.items[0].item.id);

    nextDrill.mockResolvedValue({
      question: "Q", choices: null, correctAnswer: "the email",
      explanation: "冠詞", targetTypeIds: [typeId],
    });
    const attempt = await issueDrill(session.id, userId, TODAY);
    await answerDrill(attempt.id, "the email", TODAY);

    const [rs] = await db.select().from(s.reviewState).where(eq(s.reviewState.typeId, typeId));
    expect(rs.intervalStep).toBe(1);
    expect(rs.dueOn).toBe(addDays(TODAY, INTERVALS[1]));
  });

  it("誤答で間隔がリセットされ、発生回数が増える", async () => {
    const typeId = await seedApprovedWeakness("冠詞の付け忘れ");
    await db.update(s.reviewState).set({ intervalStep: 2, consecutiveCorrect: 2 })
      .where(eq(s.reviewState.typeId, typeId));

    stubMenu();
    const menu = await ensureMenu(userId, TODAY);
    const session = await startSession(userId, menu!.items[0].item.id);

    nextDrill.mockResolvedValue({
      question: "Q", choices: null, correctAnswer: "the email",
      explanation: "冠詞", targetTypeIds: [typeId],
    });
    const attempt = await issueDrill(session.id, userId, TODAY);
    await answerDrill(attempt.id, "mail", TODAY);

    const [rs] = await db.select().from(s.reviewState).where(eq(s.reviewState.typeId, typeId));
    expect(rs.intervalStep).toBe(0);
    expect(rs.dueOn).toBe(addDays(TODAY, 1));

    const [w] = await db.select().from(s.weaknessTypes).where(eq(s.weaknessTypes.id, typeId));
    expect(w.occurrenceCount).toBe(2);
  });

  it("最終間隔まで正解し続けると卒業してキューから外れる", async () => {
    const typeId = await seedApprovedWeakness("hardly の誤用");
    await db.update(s.reviewState).set({ intervalStep: 3, consecutiveCorrect: 3 })
      .where(eq(s.reviewState.typeId, typeId));

    stubMenu();
    const menu = await ensureMenu(userId, TODAY);
    const session = await startSession(userId, menu!.items[0].item.id);
    nextDrill.mockResolvedValue({
      question: "Q", choices: null, correctAnswer: "ok", explanation: "", targetTypeIds: [typeId],
    });
    const attempt = await issueDrill(session.id, userId, TODAY);
    const r = await answerDrill(attempt.id, "ok", TODAY);

    expect(r.graduated).toContain(typeId);
    const [w] = await db.select().from(s.weaknessTypes).where(eq(s.weaknessTypes.id, typeId));
    expect(w.status).toBe("mastered");
    expect(await dueWeaknesses(userId, addDays(TODAY, 60))).toHaveLength(0);
  });

  it("添削で既知の型に名寄せされると再発として記録される", async () => {
    const typeId = await seedApprovedWeakness("冠詞の付け忘れ");
    stubMenu();
    const menu = await ensureMenu(userId, TODAY);
    const session = await startSession(userId, menu!.items[0].item.id);

    completeSession.mockResolvedValue({
      summary: "英作文2文", updatedCurrentState: null, nextAction: "次",
      detectedTypes: [{
        knownTypeId: typeId, label: "冠詞の付け忘れ", description: "",
        exampleWrong: "checked mail", exampleRight: "checked the email",
      }],
    });
    const result = await finishSession(session.id, userId, TODAY);

    // 新規ではなく既存の型が増えている
    expect(result.pendingTypes).toHaveLength(0);
    const [w] = await db.select().from(s.weaknessTypes).where(eq(s.weaknessTypes.id, typeId));
    expect(w.occurrenceCount).toBe(2);

    const events = await db.select().from(s.weaknessEvents).where(eq(s.weaknessEvents.typeId, typeId));
    expect(events.map((e) => e.kind)).toContain("recurrence");

    // 再発したので間隔はリセットされ、翌日また出る
    const [rs] = await db.select().from(s.reviewState).where(eq(s.reviewState.typeId, typeId));
    expect(rs.dueOn).toBe(addDays(TODAY, 1));
  });
});

describe("ストリーク", () => {
  it("連続した日は積み上がり、空いた日でリセットされる", async () => {
    stubMenu();
    completeSession.mockResolvedValue({
      summary: "テスト", updatedCurrentState: null, nextAction: "次", detectedTypes: [],
    });

    for (const [i, day] of ["2026-09-08", "2026-09-09", "2026-09-12"].entries()) {
      await ensureMenu(userId, day, i > 0);
      const menu = await ensureMenu(userId, day);
      const session = await startSession(userId, menu!.items[0].item.id);
      await finishSession(session.id, userId, day);
    }

    const [st] = await db.select().from(s.streaks).where(eq(s.streaks.userId, userId));
    expect(st.currentStreak).toBe(1);  // 9/10, 9/11 が空いたのでリセット
    expect(st.longestStreak).toBe(2);  // 9/8-9/9
    expect(st.totalDays).toBe(3);
  });
});
