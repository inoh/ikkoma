import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { streaks } from "@/lib/db/schema";
import { currentUserId, DEFAULT_TIMEZONE } from "@/lib/config";
import { todayInTz } from "@/lib/domain/menu";
import { isStreakAlive } from "@/lib/domain/streak";
import { getMenu } from "@/lib/services/menu";
import { activeTopics } from "@/lib/services/topics";
import { dueWeaknesses } from "@/lib/services/weakness";
import { TabBar } from "@/components/TabBar";
import { TodayActions } from "@/components/TodayActions";
import { BlockChip, Empty, Progress, StreakBadge, TopicDot } from "@/components/ui";

export const dynamic = "force-dynamic";

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

export default async function TodayPage() {
  const userId = currentUserId();
  const today = todayInTz(DEFAULT_TIMEZONE);

  const [menu, [streak], topics, due] = await Promise.all([
    getMenu(userId, today),
    db.select().from(streaks).where(eq(streaks.userId, userId)),
    activeTopics(userId),
    dueWeaknesses(userId, today),
  ]);

  const d = new Date(`${today}T00:00:00Z`);
  const dateLabel = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEKDAY[d.getUTCDay()]})`;
  const alive = isStreakAlive(
    {
      currentStreak: streak?.currentStreak ?? 0, longestStreak: streak?.longestStreak ?? 0,
      totalDays: streak?.totalDays ?? 0, lastStudiedOn: streak?.lastStudiedOn ?? null,
    },
    today,
  );

  const items = menu?.items ?? [];
  const totalMin = items.reduce((s, i) => s + i.item.minutes, 0);
  const doneMin = items.filter((i) => i.item.status === "done").reduce((s, i) => s + i.item.minutes, 0);
  const firstPending = items.find((i) => i.item.status === "pending") ?? null;

  return (
    <div className="shell">
      <header className="header">
        <div className="row row--between">
          <div className="col" style={{ gap: 2 }}>
            <h1 className="h1">{dateLabel}</h1>
            <span className="sub">
              {topics.length > 0 ? topics.map((t) => t.title).join(" ・ ") : "トピックがありません"}
            </span>
          </div>
          <StreakBadge days={streak?.currentStreak ?? 0} alive={alive} />
        </div>
      </header>

      <div className="body">
        {topics.length === 0 ? (
          <>
            <Empty>
              まず学習したい目標を1つ登録してください。<br />
              AI がマイルストーンに分解します。
            </Empty>
            <Link href="/onboarding"><button className="btn">目標を登録する</button></Link>
          </>
        ) : (
          <>
            <div className="row row--between">
              <h2 className="h2">今日の30分</h2>
              <span className="meta">
                {totalMin > 0 ? `${doneMin}分 / ${totalMin}分 完了` : "未生成"}
              </span>
            </div>
            <Progress value={totalMin ? (doneMin / totalMin) * 100 : 0} />

            {due.length > 0 && (
              <Link href="/weaknesses">
                <div className="card card--brand" style={{ gap: 2 }}>
                  <strong style={{ fontSize: 13, color: "var(--brand-600)" }}>
                    復習の期限が {due.length}件 来ています
                  </strong>
                  <span className="meta">冒頭の復習ブロックで自動的に消化されます</span>
                </div>
              </Link>
            )}

            {items.length === 0 ? (
              <Empty>今日のメニューはまだ生成されていません。</Empty>
            ) : (
              items.map(({ item, topic }) => (
                <div key={item.id} className={`card${item.status === "done" ? " card--muted" : ""}`}>
                  <div className="row">
                    <span className="chip" style={{ background: "var(--ink-100)", fontWeight: 700 }}>
                      {item.minutes}分
                    </span>
                    <BlockChip kind={item.blockKind} />
                    <TopicDot token={topic.colorToken} />
                    <span className="meta grow">{topic.title}</span>
                    {item.status === "done" && (
                      <span className="meta" style={{ color: "var(--success-600)" }}>✓ 完了</span>
                    )}
                    {item.status === "skipped" && <span className="meta">スキップ</span>}
                  </div>
                  <h3 className="h3" style={{ color: item.status === "pending" ? undefined : "var(--ink-500)" }}>
                    {item.title}
                  </h3>
                  <p className="sub" style={{ margin: 0 }}>{item.instruction}</p>
                </div>
              ))
            )}

            <div className="grow" />
            <TodayActions hasMenu={items.length > 0} firstItemId={firstPending?.item.id ?? null} />
          </>
        )}
      </div>

      <TabBar active="/" />
    </div>
  );
}
