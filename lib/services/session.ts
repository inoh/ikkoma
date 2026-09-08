import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  attempts, corrections, menuItems, messages, sessions, streaks, topics, weaknessTypes,
} from "@/lib/db/schema";
import { nextDrill, type Drill, type DrillRequest } from "@/lib/ai/drill";
import { correct as aiCorrect, type CorrectionRequest, type CorrectionResult } from "@/lib/ai/correction";
import { completeSession as aiComplete, type CompleteRequest, type CompleteResult } from "@/lib/ai/complete";
import { applyStudyDay } from "@/lib/domain/streak";
import { currentMilestone } from "./topics";
import { applyReviewOutcome, pickTargets, recordDetectedTypes } from "./weakness";

export async function startSession(userId: string, menuItemId: string) {
  const [item] = await db.select().from(menuItems).where(eq(menuItems.id, menuItemId));
  if (!item) throw new Error("menu item not found");

  // 中断していたセッションがあれば再開する
  const [existing] = await db.select().from(sessions)
    .where(and(eq(sessions.menuItemId, menuItemId), eq(sessions.state, "in_progress")));
  if (existing) return existing;

  const [s] = await db.insert(sessions).values({
    userId, topicId: item.topicId, menuItemId, state: "in_progress",
  }).returning();
  await db.insert(messages).values({
    sessionId: s.id, role: "assistant",
    content: `${item.title}\n\n${item.instruction}\n\n準備ができたら「始める」と送ってください。`,
  });
  return s;
}

export async function getSession(sessionId: string) {
  const [row] = await db.select({ session: sessions, topic: topics, item: menuItems })
    .from(sessions)
    .innerJoin(topics, eq(topics.id, sessions.topicId))
    .leftJoin(menuItems, eq(menuItems.id, sessions.menuItemId))
    .where(eq(sessions.id, sessionId));
  if (!row) return null;
  const msgs = await db.select().from(messages)
    .where(eq(messages.sessionId, sessionId)).orderBy(asc(messages.createdAt));
  const atts = await db.select().from(attempts)
    .where(eq(attempts.sessionId, sessionId)).orderBy(asc(attempts.createdAt));
  const corrs = await db.select().from(corrections)
    .where(eq(corrections.sessionId, sessionId)).orderBy(asc(corrections.createdAt));
  return { ...row, messages: msgs, attempts: atts, corrections: corrs };
}

/* ---------------- 出題 ---------------- */

/** 出題に必要な材料。狙う弱点は重み付き抽選済みで入る */
export async function buildDrillContext(
  sessionId: string, userId: string, today: string,
): Promise<DrillRequest> {
  const s = await getSession(sessionId);
  if (!s) throw new Error("session not found");
  const ms = await currentMilestone(s.topic.id);
  const targets = await pickTargets(userId, s.topic.id, today, 1);
  return {
    topicTitle: s.topic.title,
    instruction: s.item?.instruction ?? s.topic.goal,
    currentMilestone: ms ? `${ms.code} ${ms.title}` : null,
    targetWeaknesses: targets.map((t) => ({
      id: t.type.id, label: t.type.label, description: t.type.description, exampleWrong: t.type.exampleWrong,
    })),
    recentQuestions: s.attempts.slice(-5).map((a) => a.question),
  };
}

export async function saveDrill(sessionId: string, drill: Drill) {
  const [row] = await db.insert(attempts).values({
    sessionId, question: drill.question, choices: drill.choices ?? null,
    correctAnswer: drill.correctAnswer, explanation: drill.explanation,
    targetTypeIds: drill.targetTypeIds ?? [],
  }).returning();
  return row;
}

/** API 経由の経路 */
export async function issueDrill(sessionId: string, userId: string, today: string) {
  const ctx = await buildDrillContext(sessionId, userId, today);
  return saveDrill(sessionId, await nextDrill(ctx));
}

/** 解答を採点し、狙っていた弱点の間隔反復に反映する */
export async function answerDrill(attemptId: string, userAnswer: string, today: string) {
  const [a] = await db.select().from(attempts).where(eq(attempts.id, attemptId));
  if (!a) throw new Error("attempt not found");

  const isCorrect = normalize(userAnswer) === normalize(a.correctAnswer);
  await db.update(attempts).set({ userAnswer, isCorrect }).where(eq(attempts.id, attemptId));

  const { graduated } = await applyReviewOutcome(a.targetTypeIds, isCorrect, today, a.sessionId);
  return { attempt: { ...a, userAnswer, isCorrect }, graduated };
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/[.。、,\s]/g, "");
}

/* ---------------- 添削 ---------------- */

/**
 * 添削の材料。既知の弱点型を必ず含める。
 * これを渡さないと同じミスに毎回違うラベルが付き、弱点リストが名寄せできずに壊れる。
 */
export async function buildCorrectionContext(
  sessionId: string, userId: string, userText: string,
): Promise<CorrectionRequest> {
  const s = await getSession(sessionId);
  if (!s) throw new Error("session not found");
  const known = await db.select().from(weaknessTypes)
    .where(and(eq(weaknessTypes.userId, userId), eq(weaknessTypes.topicId, s.topic.id)));
  return {
    topicTitle: s.topic.title,
    instruction: s.item?.instruction ?? s.topic.goal,
    userText,
    knownTypes: known.filter((k) => k.status !== "dismissed")
      .map((k) => ({ id: k.id, label: k.label, description: k.description })),
  };
}

export async function saveCorrection(sessionId: string, userText: string, result: CorrectionResult) {
  const [row] = await db.insert(corrections).values({
    sessionId, userText, correctedText: result.correctedText,
    diff: result.diff, feedback: result.feedback,
  }).returning();
  await db.insert(messages).values([
    { sessionId, role: "user", content: userText },
    { sessionId, role: "assistant", content: result.feedback },
  ]);
  return { correction: row, detectedTypes: result.detectedTypes };
}

/** API 経由の経路 */
export async function submitWriting(sessionId: string, userId: string, userText: string) {
  const ctx = await buildCorrectionContext(sessionId, userId, userText);
  return saveCorrection(sessionId, userText, await aiCorrect(ctx));
}

export async function addMessage(sessionId: string, role: "user" | "assistant", content: string) {
  const [m] = await db.insert(messages).values({ sessionId, role, content }).returning();
  return m;
}

/* ---------------- 完了 ---------------- */

export async function buildCompletionContext(
  sessionId: string, userId: string,
): Promise<CompleteRequest & { alreadyCompleted: boolean }> {
  const s = await getSession(sessionId);
  if (!s) throw new Error("session not found");
  const ms = await currentMilestone(s.topic.id);
  const known = await db.select().from(weaknessTypes)
    .where(and(eq(weaknessTypes.userId, userId), eq(weaknessTypes.topicId, s.topic.id)));

  return {
    alreadyCompleted: s.session.state === "completed",
    topicTitle: s.topic.title,
    currentState: s.topic.currentState,
    currentMilestone: ms ? `${ms.code} ${ms.title}` : null,
    durationMinutes: elapsedMinutes(s.session.startedAt),
    attempts: s.attempts.map((a) => ({
      question: a.question, userAnswer: a.userAnswer, correctAnswer: a.correctAnswer, isCorrect: a.isCorrect,
    })),
    corrections: s.corrections.map((c) => ({
      userText: c.userText, correctedText: c.correctedText, feedback: c.feedback,
    })),
    knownTypes: known.filter((k) => k.status !== "dismissed")
      .map((k) => ({ id: k.id, label: k.label, description: k.description })),
  };
}

function elapsedMinutes(startedAt: Date) {
  return Math.max(1, Math.round((Date.now() - startedAt.getTime()) / 60_000));
}

/**
 * セッション完了の確定処理。
 * ログ・ストリーク・現在地・弱点の下書きがここでまとめて書かれる（ユーザーには書かせない）。
 */
export async function applyCompletion(
  sessionId: string, userId: string, today: string, result: CompleteResult,
) {
  const s = await getSession(sessionId);
  if (!s) throw new Error("session not found");
  if (s.session.state === "completed") return summarize(sessionId, userId);

  await db.update(sessions).set({
    state: "completed", endedAt: new Date(),
    durationMinutes: elapsedMinutes(s.session.startedAt),
    summary: result.summary,
  }).where(eq(sessions.id, sessionId));

  if (s.session.menuItemId) {
    await db.update(menuItems).set({ status: "done" }).where(eq(menuItems.id, s.session.menuItemId));
  }

  const patch: Partial<typeof topics.$inferInsert> = { nextActions: [result.nextAction] };
  if (result.updatedCurrentState) patch.currentState = result.updatedCurrentState;
  await db.update(topics).set(patch).where(eq(topics.id, s.topic.id));

  await recordDetectedTypes({
    userId, topicId: s.topic.id, sessionId, today, detected: result.detectedTypes,
  });

  const [cur] = await db.select().from(streaks).where(eq(streaks.userId, userId));
  const next = applyStudyDay({
    currentStreak: cur?.currentStreak ?? 0,
    longestStreak: cur?.longestStreak ?? 0,
    totalDays: cur?.totalDays ?? 0,
    lastStudiedOn: cur?.lastStudiedOn ?? null,
  }, today);
  await db.insert(streaks).values({ userId, ...next })
    .onConflictDoUpdate({ target: streaks.userId, set: next });

  return summarize(sessionId, userId);
}

/** API 経由の経路 */
export async function finishSession(sessionId: string, userId: string, today: string) {
  const ctx = await buildCompletionContext(sessionId, userId);
  if (ctx.alreadyCompleted) return summarize(sessionId, userId);
  const { alreadyCompleted: _ignored, ...req } = ctx;
  return applyCompletion(sessionId, userId, today, await aiComplete(req));
}

/** S3 (結果画面) に出すデータ */
export async function summarize(sessionId: string, userId: string) {
  const s = await getSession(sessionId);
  if (!s) throw new Error("session not found");

  const pending = await db.select().from(weaknessTypes)
    .where(and(eq(weaknessTypes.userId, userId), eq(weaknessTypes.approved, false),
      eq(weaknessTypes.status, "active"), eq(weaknessTypes.topicId, s.topic.id)))
    .orderBy(desc(weaknessTypes.firstSeenAt));

  const graduated = await db.select().from(weaknessTypes)
    .where(and(eq(weaknessTypes.userId, userId), eq(weaknessTypes.status, "mastered")))
    .orderBy(desc(weaknessTypes.lastSeenAt)).limit(3);

  const [streak] = await db.select().from(streaks).where(eq(streaks.userId, userId));
  const correctCount = s.attempts.filter((a) => a.isCorrect).length;

  return {
    session: s.session,
    topic: s.topic,
    pendingTypes: pending,
    graduated,
    streak: streak ?? null,
    score: { correct: correctCount, total: s.attempts.length },
    nextAction: s.topic.nextActions[0] ?? null,
  };
}
