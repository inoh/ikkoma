import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { milestones, topicMenuTemplates, topics } from "@/lib/db/schema";

/** 現在のマイルストーン = 未完了のうち order_index 最小。テーブルには持たず都度導出する */
export async function currentMilestone(topicId: string) {
  const rows = await db.select().from(milestones)
    .where(and(eq(milestones.topicId, topicId), isNull(milestones.completedAt)))
    .orderBy(asc(milestones.orderIndex)).limit(1);
  return rows[0] ?? null;
}

export async function listTopics(userId: string) {
  const rows = await db.select().from(topics).where(eq(topics.userId, userId));
  const order = { active: 0, paused: 1, done: 2 } as const;
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title));
}

export async function activeTopics(userId: string) {
  return db.select().from(topics)
    .where(and(eq(topics.userId, userId), eq(topics.status, "active")));
}

export async function topicDetail(topicId: string) {
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId));
  if (!topic) return null;
  const ms = await db.select().from(milestones)
    .where(eq(milestones.topicId, topicId)).orderBy(asc(milestones.orderIndex));
  const template = await db.select().from(topicMenuTemplates)
    .where(eq(topicMenuTemplates.topicId, topicId)).orderBy(asc(topicMenuTemplates.orderIndex));
  return { topic, milestones: ms, template };
}

/** 完了マイルストーン数から進捗%を導出する（手動上書きも許す） */
export async function recomputeProgress(topicId: string) {
  const ms = await db.select().from(milestones).where(eq(milestones.topicId, topicId));
  if (ms.length === 0) return 0;
  const done = ms.filter((m) => m.completedAt !== null).length;
  const progress = Math.round((done / ms.length) * 100);
  await db.update(topics).set({ progress }).where(eq(topics.id, topicId));
  return progress;
}

export async function toggleMilestone(milestoneId: string, done: boolean) {
  const [m] = await db.update(milestones)
    .set({ completedAt: done ? new Date() : null })
    .where(eq(milestones.id, milestoneId)).returning();
  if (m) await recomputeProgress(m.topicId);
  return m ?? null;
}

export async function pauseTopic(topicId: string, reason: string) {
  const [t] = await db.update(topics)
    .set({ status: "paused", pausedReason: reason, pausedAt: new Date() })
    .where(eq(topics.id, topicId)).returning();
  return t ?? null;
}

/** 再開時は空白期間を返す。長ければ現在地の再確認セッションを挟む判断に使う */
export async function resumeTopic(topicId: string) {
  const [before] = await db.select().from(topics).where(eq(topics.id, topicId));
  if (!before) return null;
  const gapDays = before.pausedAt
    ? Math.round((Date.now() - before.pausedAt.getTime()) / 86_400_000)
    : 0;
  const [t] = await db.update(topics)
    .set({ status: "active", pausedReason: null, pausedAt: null })
    .where(eq(topics.id, topicId)).returning();
  return { topic: t, gapDays, needsRecheck: gapDays >= 14 };
}

export async function completeTopic(topicId: string) {
  const [t] = await db.update(topics)
    .set({ status: "done", progress: 100, completedAt: new Date() })
    .where(eq(topics.id, topicId)).returning();
  return t ?? null;
}
