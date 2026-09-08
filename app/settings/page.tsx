import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationSettings, rhythmPhases, rhythmSlots, topics, users } from "@/lib/db/schema";
import { currentUserId } from "@/lib/config";
import { TabBar } from "@/components/TabBar";
import { Chip, TopicDot } from "@/components/ui";

export const dynamic = "force-dynamic";

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

export default async function SettingsPage() {
  const userId = currentUserId();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const notifs = await db.select().from(notificationSettings).where(eq(notificationSettings.userId, userId));
  const [phase] = await db.select().from(rhythmPhases)
    .where(eq(rhythmPhases.userId, userId));
  const slots = phase
    ? await db.select({ slot: rhythmSlots, topic: topics })
        .from(rhythmSlots).innerJoin(topics, eq(topics.id, rhythmSlots.topicId))
        .where(eq(rhythmSlots.phaseId, phase.id))
    : [];

  const byDay = WEEKDAY.map((_, w) => ({
    main: slots.find((s) => s.slot.weekday === w && s.slot.role !== "warmup"),
    warmup: slots.find((s) => s.slot.weekday === w && s.slot.role === "warmup"),
  }));

  return (
    <div className="shell">
      <header className="header">
        <h1 className="h1">設定</h1>
        <span className="sub">通知・週次リズム・1日の目標時間</span>
      </header>

      <div className="body">
        <div className="card" style={{ gap: 14 }}>
          <strong style={{ fontSize: 13 }}>リマインド</strong>
          {notifs.map((n) => (
            <div key={n.id} className="row">
              <div className="col grow" style={{ gap: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  {n.kind === "noon" ? "昼の通知" : "夜の通知"}
                </span>
                <span className="meta">
                  {n.kind === "noon" ? "今日の30分メニューを届ける" : "未実施ならメニューを再提示"}
                </span>
              </div>
              <strong className="linkbtn">{n.time}</strong>
            </div>
          ))}
          {notifs.length === 0 && <span className="meta">通知は未設定です</span>}
          <span className="meta">
            配信は Vercel Cron（vercel.json）から /api/cron/notify を叩いて行います。
          </span>
        </div>

        <div className="card">
          <div className="row row--between">
            <strong style={{ fontSize: 13 }}>週次リズム</strong>
            {phase && <Chip bg="var(--brand-100)" fg="var(--brand-600)">{phase.name}</Chip>}
          </div>
          {phase?.switchCondition && (
            <span className="meta">切替条件: {phase.switchCondition}</span>
          )}
          <div className="row" style={{ gap: 4, alignItems: "stretch" }}>
            {byDay.map((d, w) => (
              <div key={w} className="col grow" style={{ gap: 5, alignItems: "center" }}>
                <span className="meta">{WEEKDAY[w]}</span>
                <div style={{
                  width: "100%", padding: "10px 0", borderRadius: 8, textAlign: "center",
                  background: d.main ? `var(--${d.main.topic.colorToken.replace("/", "-")})` : "var(--ink-100)",
                  color: d.main ? "#fff" : "var(--ink-500)", fontSize: 11, fontWeight: 700,
                }}>
                  {d.main ? d.main.topic.title.slice(0, 2) : "—"}
                </div>
                {d.warmup && <span className="meta" style={{ fontSize: 9 }}>+5分</span>}
              </div>
            ))}
          </div>
          {slots.length === 0 && <span className="meta">週次リズムは未設定です</span>}
          <span className="meta">
            「+5分」は冒頭に混ぜる warmup ブロック。語学の毎日接触を切らさないための枠です。
          </span>
        </div>

        <div className="card" style={{ gap: 14 }}>
          <strong style={{ fontSize: 13 }}>学習</strong>
          <div className="row">
            <div className="col grow" style={{ gap: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>1日の目標時間</span>
              <span className="meta">必須ノルマ。これ以上は任意</span>
            </div>
            <strong className="linkbtn">{user?.dailyGoalMinutes ?? 30}分</strong>
          </div>
          <div className="row">
            <div className="col grow" style={{ gap: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>アカウント</span>
              <span className="meta">{user?.email}</span>
            </div>
          </div>
        </div>
        <div className="grow" />
      </div>

      <TabBar active="/settings" />
    </div>
  );
}
