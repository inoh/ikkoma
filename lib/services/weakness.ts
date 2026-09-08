import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { reviewState, topics, weaknessEvents, weaknessTypes } from "@/lib/db/schema";
import { initialReviewState, isMastered, onReview, pickWeighted, type ReviewSnapshot } from "@/lib/domain/review";

export type WeaknessWithReview = {
  type: typeof weaknessTypes.$inferSelect;
  review: typeof reviewState.$inferSelect | null;
  topicTitle: string;
  topicColor: string;
};

export async function listWeaknesses(userId: string, opts: { topicId?: string } = {}) {
  const rows = await db.select({ type: weaknessTypes, review: reviewState, topicTitle: topics.title, topicColor: topics.colorToken })
    .from(weaknessTypes)
    .leftJoin(reviewState, eq(reviewState.typeId, weaknessTypes.id))
    .innerJoin(topics, eq(topics.id, weaknessTypes.topicId))
    .where(opts.topicId
      ? and(eq(weaknessTypes.userId, userId), eq(weaknessTypes.topicId, opts.topicId))
      : eq(weaknessTypes.userId, userId))
    .orderBy(desc(weaknessTypes.occurrenceCount), desc(weaknessTypes.lastSeenAt));
  return rows as WeaknessWithReview[];
}

/** 今日期限が来ている弱点。承認済み・active のものだけがメニューに入る */
export async function dueWeaknesses(userId: string, today: string) {
  const rows = await db.select({ type: weaknessTypes, review: reviewState, topicTitle: topics.title, topicColor: topics.colorToken })
    .from(weaknessTypes)
    .innerJoin(reviewState, eq(reviewState.typeId, weaknessTypes.id))
    .innerJoin(topics, eq(topics.id, weaknessTypes.topicId))
    .where(and(
      eq(weaknessTypes.userId, userId),
      eq(weaknessTypes.status, "active"),
      eq(weaknessTypes.approved, true),
      lte(reviewState.dueOn, today),
    ));
  return rows as WeaknessWithReview[];
}

/** 出題対象を重み付き抽選で選ぶ */
export async function pickTargets(userId: string, topicId: string, today: string, count: number) {
  const all = await dueWeaknesses(userId, today);
  const scoped = all.filter((w) => w.type.topicId === topicId);
  const pool = (scoped.length > 0 ? scoped : all).map((w) => ({
    ...w, occurrenceCount: w.type.occurrenceCount, dueOn: w.review!.dueOn,
  }));
  return pickWeighted(pool, today, count);
}

type DetectedType = {
  knownTypeId: string | null;
  label: string; description: string; exampleWrong: string; exampleRight: string;
};

/**
 * AI が抽出した型を DB に反映する。
 * 新規は approved=false の下書きとして入れ、ユーザーが S3 で承認するまで出題に使わない。
 * 既知への再発は occurrenceCount を増やし、間隔をリセットする。
 */
export async function recordDetectedTypes(args: {
  userId: string; topicId: string; sessionId: string; today: string; detected: DetectedType[];
}) {
  const created: string[] = [];
  const recurred: string[] = [];

  for (const d of args.detected) {
    if (d.knownTypeId) {
      const [existing] = await db.select().from(weaknessTypes).where(eq(weaknessTypes.id, d.knownTypeId));
      if (!existing) continue;
      await db.update(weaknessTypes).set({
        occurrenceCount: existing.occurrenceCount + 1,
        lastSeenAt: new Date(),
        exampleWrong: d.exampleWrong || existing.exampleWrong,
        exampleRight: d.exampleRight || existing.exampleRight,
      }).where(eq(weaknessTypes.id, existing.id));
      await db.insert(weaknessEvents).values({
        typeId: existing.id, sessionId: args.sessionId, kind: "recurrence", evidence: d.exampleWrong,
      });
      // 再発は間隔リセット
      const snap = initialReviewState(args.today);
      await db.insert(reviewState).values({ typeId: existing.id, ...snap })
        .onConflictDoUpdate({ target: reviewState.typeId, set: { ...snap } });
      recurred.push(existing.id);
    } else {
      const [row] = await db.insert(weaknessTypes).values({
        userId: args.userId, topicId: args.topicId, label: d.label, description: d.description,
        exampleWrong: d.exampleWrong, exampleRight: d.exampleRight,
        origin: "correction", approved: false, occurrenceCount: 1,
      }).returning();
      await db.insert(weaknessEvents).values({
        typeId: row.id, sessionId: args.sessionId, kind: "new", evidence: d.exampleWrong,
      });
      created.push(row.id);
    }
  }
  return { created, recurred };
}

/** 承認して初めて間隔反復キューに入る */
export async function approveWeakness(typeId: string, today: string) {
  await db.update(weaknessTypes).set({ approved: true }).where(eq(weaknessTypes.id, typeId));
  const snap = initialReviewState(today);
  await db.insert(reviewState).values({ typeId, ...snap })
    .onConflictDoUpdate({ target: reviewState.typeId, set: { ...snap } });
}

export async function rejectWeakness(typeId: string) {
  await db.update(weaknessTypes).set({ status: "dismissed", approved: false })
    .where(eq(weaknessTypes.id, typeId));
}

/** ドリルの正誤を間隔反復に反映する。卒業したら mastered にしてキューから外す */
export async function applyReviewOutcome(typeIds: string[], correct: boolean, today: string, sessionId?: string) {
  if (typeIds.length === 0) return { graduated: [] as string[] };
  const states = await db.select().from(reviewState).where(inArray(reviewState.typeId, typeIds));
  const graduated: string[] = [];

  for (const s of states) {
    const next: ReviewSnapshot = onReview(
      { intervalStep: s.intervalStep, dueOn: s.dueOn, consecutiveCorrect: s.consecutiveCorrect },
      correct, today,
    );
    await db.update(reviewState).set({ ...next, lastReviewedAt: new Date() })
      .where(eq(reviewState.typeId, s.typeId));

    if (correct && isMastered(next)) {
      await db.update(weaknessTypes).set({ status: "mastered" }).where(eq(weaknessTypes.id, s.typeId));
      await db.insert(weaknessEvents).values({ typeId: s.typeId, sessionId: sessionId ?? null, kind: "cleared" });
      graduated.push(s.typeId);
    } else if (!correct) {
      await db.update(weaknessTypes)
        .set({ occurrenceCount: sql`${weaknessTypes.occurrenceCount} + 1`, lastSeenAt: new Date() })
        .where(eq(weaknessTypes.id, s.typeId));
      await db.insert(weaknessEvents).values({ typeId: s.typeId, sessionId: sessionId ?? null, kind: "recurrence" });
    }
  }
  return { graduated };
}
