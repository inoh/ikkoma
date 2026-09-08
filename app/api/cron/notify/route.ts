import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { currentUserId, DEFAULT_TIMEZONE } from "@/lib/config";
import { todayInTz } from "@/lib/domain/menu";
import { ensureMenu, getMenu } from "@/lib/services/menu";

export const maxDuration = 60;

/**
 * Vercel Cron から呼ばれる。
 *   昼: 今日のメニューを生成して通知する
 *   夜: 未実施ならメニューを再提示、実施済みなら称賛する
 * docs/02-features.md「G. リマインド通知」に対応。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");

  // Vercel Cron は Authorization: Bearer $CRON_SECRET を付けてくる
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const userId = currentUserId();
  const today = todayInTz(DEFAULT_TIMEZONE);

  if (kind === "noon") {
    const menu = await ensureMenu(userId, today);
    return NextResponse.json({
      kind, today,
      notification: menu
        ? { title: "今日の30分", body: menu.items.map((i) => `${i.item.minutes}分 ${i.item.title}`).join(" / ") }
        : { title: "トピックがありません", body: "まず目標を登録してください" },
    });
  }

  if (kind === "night") {
    const done = await db.select().from(sessions).where(and(
      eq(sessions.userId, userId), eq(sessions.state, "completed"),
      gte(sessions.startedAt, new Date(`${today}T00:00:00+09:00`)),
    ));
    if (done.length > 0) {
      return NextResponse.json({
        kind, today, done: true,
        notification: { title: "今日もお疲れさまでした", body: done.map((d) => d.summary).filter(Boolean).join(" / ") },
      });
    }
    const menu = await getMenu(userId, today);
    return NextResponse.json({
      kind, today, done: false,
      notification: {
        title: "今日まだ30分やっていません",
        body: menu ? menu.items.map((i) => `${i.item.minutes}分 ${i.item.title}`).join(" / ") : "メニューを生成してください",
      },
    });
  }

  return NextResponse.json({ error: "kind must be noon or night" }, { status: 400 });
}
