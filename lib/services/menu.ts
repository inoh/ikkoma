import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  dailyMenus, menuItems, rhythmPhases, rhythmSlots, sessions, topicMenuTemplates, topics, users,
} from "@/lib/db/schema";
import { generateMenu, type MenuContext } from "@/lib/ai/menu";
import { addDays } from "@/lib/domain/review";
import { weekdayOf } from "@/lib/domain/menu";
import { activeTopics, currentMilestone } from "./topics";
import { dueWeaknesses } from "./weakness";

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

export async function getMenu(userId: string, date: string) {
  const [menu] = await db.select().from(dailyMenus)
    .where(and(eq(dailyMenus.userId, userId), eq(dailyMenus.date, date)));
  if (!menu) return null;
  const items = await db.select({ item: menuItems, topic: topics })
    .from(menuItems).innerJoin(topics, eq(topics.id, menuItems.topicId))
    .where(eq(menuItems.menuId, menu.id)).orderBy(menuItems.orderIndex);
  return { menu, items };
}

async function buildContext(userId: string, date: string, goalMinutes: number): Promise<MenuContext> {
  const actives = await activeTopics(userId);
  const weekday = weekdayOf(date);

  // 今日のフェーズ配分（あれば）
  const [phase] = await db.select().from(rhythmPhases)
    .where(and(eq(rhythmPhases.userId, userId), eq(rhythmPhases.isActive, true)));
  const slots = phase
    ? await db.select().from(rhythmSlots)
        .where(and(eq(rhythmSlots.phaseId, phase.id), eq(rhythmSlots.weekday, weekday)))
    : [];
  const roleOf = new Map(slots.map((s) => [s.topicId, s.role]));

  const topicCtx = await Promise.all(actives.map(async (t) => {
    const ms = await currentMilestone(t.id);
    const template = await db.select().from(topicMenuTemplates)
      .where(eq(topicMenuTemplates.topicId, t.id)).orderBy(topicMenuTemplates.orderIndex);
    return {
      id: t.id, title: t.title, goal: t.goal, currentState: t.currentState,
      nextActions: t.nextActions,
      currentMilestone: ms ? `${ms.code} ${ms.title}${ms.detail ? ` — ${ms.detail}` : ""}` : null,
      menuTemplate: template.map((x) => ({ blockKind: x.blockKind, minutes: x.minutes, instruction: x.instruction })),
      role: roleOf.get(t.id) ?? null,
    };
  }));

  const due = await dueWeaknesses(userId, date);
  const recent = await db.select({ session: sessions, topic: topics })
    .from(sessions).innerJoin(topics, eq(topics.id, sessions.topicId))
    .where(and(eq(sessions.userId, userId), gte(sessions.startedAt, new Date(`${addDays(date, -7)}T00:00:00Z`))))
    .orderBy(desc(sessions.startedAt)).limit(10);

  return {
    date,
    weekdayLabel: WEEKDAY_JA[weekday],
    goalMinutes,
    topics: topicCtx,
    dueWeaknesses: due.map((w) => ({
      id: w.type.id, topicId: w.type.topicId, label: w.type.label,
      occurrenceCount: w.type.occurrenceCount, exampleWrong: w.type.exampleWrong,
    })),
    recentLog: recent.map((r) => ({
      date: r.session.startedAt.toISOString().slice(0, 10),
      topic: r.topic.title,
      summary: r.session.summary ?? "",
    })),
  };
}

/**
 * 今日のメニューを生成して保存する。
 * 1日1回キャッシュし、`force` のときだけ作り直す（コスト設計上ここが効く）。
 */
export async function ensureMenu(userId: string, date: string, force = false) {
  const existing = await getMenu(userId, date);
  if (existing && !force) return existing;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("user not found");

  const actives = await activeTopics(userId);
  if (actives.length === 0) return null;

  const ctx = await buildContext(userId, date, user.dailyGoalMinutes);
  const { items } = await generateMenu(ctx);

  if (existing) {
    await db.delete(menuItems).where(eq(menuItems.menuId, existing.menu.id));
    await db.delete(dailyMenus).where(eq(dailyMenus.id, existing.menu.id));
  }

  const [menu] = await db.insert(dailyMenus).values({
    userId, date,
    totalMinutes: items.reduce((s, i) => s + i.minutes, 0),
    source: force ? "user_request" : "auto",
    regeneratedCount: existing ? existing.menu.regeneratedCount + 1 : 0,
  }).returning();

  await db.insert(menuItems).values(items.map((i, idx) => ({
    menuId: menu.id, topicId: i.topicId, blockKind: i.blockKind, minutes: i.minutes,
    title: i.title, instruction: i.instruction, reviewTypeIds: i.reviewTypeIds ?? [], orderIndex: idx,
  })));

  return getMenu(userId, date);
}

/** 「今日は5分だけ」— 最初の項目だけ残して短縮する。ストリークは維持される */
export async function shrinkToFiveMinutes(userId: string, date: string) {
  const current = await getMenu(userId, date);
  if (!current) return null;
  const [first, ...rest] = current.items;
  if (!first) return current;
  await db.update(menuItems).set({ minutes: Math.min(5, first.item.minutes) })
    .where(eq(menuItems.id, first.item.id));
  for (const r of rest) {
    await db.update(menuItems).set({ status: "skipped" }).where(eq(menuItems.id, r.item.id));
  }
  await db.update(dailyMenus).set({ totalMinutes: 5 }).where(eq(dailyMenus.id, current.menu.id));
  return getMenu(userId, date);
}
