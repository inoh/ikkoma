import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { milestones, topicMenuTemplates, topics } from "@/lib/db/schema";

const COLORS = ["topic/1", "topic/2", "topic/3", "topic/4", "topic/5", "topic/6"];

export type TopicDraft = {
  topicTitle: string;
  goal: string;
  currentState?: string;
  firstNextAction?: string;
  milestones?: { code: string; title: string; detail?: string }[];
  menuTemplate?: { blockKind: string; minutes: number; instruction: string }[];
};

/**
 * トピックを新規作成する。オンボーディング（API 経由）と MCP の両方から呼ばれる。
 * active が2つある状態での追加は止めないが警告を返す（3つ目は週次配分が破綻しやすい）。
 */
export async function createTopic(userId: string, draft: TopicDraft) {
  const actives = await activeTopics(userId);
  const warning = actives.length >= 2
    ? "active が既に2つあります。3つ目は週次リズムが破綻しやすいので、どれかを中断することを勧めます。"
    : null;

  const [t] = await db.insert(topics).values({
    userId, title: draft.topicTitle, goal: draft.goal,
    currentState: draft.currentState ?? "",
    nextActions: draft.firstNextAction ? [draft.firstNextAction] : [],
    colorToken: COLORS[actives.length % COLORS.length],
  }).returning();

  if (draft.milestones?.length) {
    await db.insert(milestones).values(draft.milestones.map((m, i) => ({
      topicId: t.id, code: m.code, title: m.title, detail: m.detail ?? null, orderIndex: i,
    })));
  }
  if (draft.menuTemplate?.length) {
    await db.insert(topicMenuTemplates).values(draft.menuTemplate.map((b, i) => ({
      topicId: t.id, blockKind: b.blockKind as never, minutes: b.minutes,
      instruction: b.instruction, orderIndex: i,
    })));
  }
  return { topic: t, warning };
}

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
