import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, streaks, topics, weaknessTypes } from "@/lib/db/schema";
import { addDays } from "@/lib/domain/review";

export async function dashboard(userId: string, today: string, weeks = 18) {
  const from = addDays(today, -(weeks * 7 - 1));

  const rows = await db.select({
    day: sql<string>`to_char(${sessions.startedAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')`,
    minutes: sql<number>`coalesce(sum(${sessions.durationMinutes}), 0)::int`,
  }).from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.state, "completed"),
      gte(sessions.startedAt, new Date(`${from}T00:00:00Z`))))
    .groupBy(sql`1`);

  const byDay = new Map(rows.map((r) => [r.day, r.minutes]));
  const heatmap: { date: string; minutes: number; level: 0 | 1 | 2 | 3 }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(from, i);
    const minutes = byDay.get(date) ?? 0;
    const level = minutes === 0 ? 0 : minutes < 20 ? 1 : minutes < 45 ? 2 : 3;
    heatmap.push({ date, minutes, level });
  }

  const weekFrom = addDays(today, -6);
  const perTopic = await db.select({
    topicId: topics.id, title: topics.title, colorToken: topics.colorToken,
    minutes: sql<number>`coalesce(sum(${sessions.durationMinutes}), 0)::int`,
  }).from(sessions).innerJoin(topics, eq(topics.id, sessions.topicId))
    .where(and(eq(sessions.userId, userId), eq(sessions.state, "completed"),
      gte(sessions.startedAt, new Date(`${weekFrom}T00:00:00Z`))))
    .groupBy(topics.id, topics.title, topics.colorToken);

  const [streak] = await db.select().from(streaks).where(eq(streaks.userId, userId));
  const totalMinutes = heatmap.reduce((s, h) => s + h.minutes, 0);
  const activeWeak = await db.select({ n: sql<number>`count(*)::int` }).from(weaknessTypes)
    .where(and(eq(weaknessTypes.userId, userId), eq(weaknessTypes.status, "active"),
      eq(weaknessTypes.approved, true)));
  const graduated = await db.select({ n: sql<number>`count(*)::int` }).from(weaknessTypes)
    .where(and(eq(weaknessTypes.userId, userId), eq(weaknessTypes.status, "mastered")));

  const recentSessions = await db.select({ session: sessions, topic: topics })
    .from(sessions).innerJoin(topics, eq(topics.id, sessions.topicId))
    .where(and(eq(sessions.userId, userId), eq(sessions.state, "completed")))
    .orderBy(desc(sessions.startedAt)).limit(10);

  return {
    streak: streak ?? { currentStreak: 0, longestStreak: 0, totalDays: 0, lastStudiedOn: null },
    heatmap,
    perTopic,
    totalMinutes,
    activeWeaknesses: activeWeak[0]?.n ?? 0,
    graduatedWeaknesses: graduated[0]?.n ?? 0,
    recentSessions,
  };
}
