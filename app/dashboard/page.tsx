import { currentUserId, DEFAULT_TIMEZONE } from "@/lib/config";
import { todayInTz } from "@/lib/domain/menu";
import { dashboard } from "@/lib/services/dashboard";
import { TabBar } from "@/components/TabBar";
import { TopicDot } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const userId = currentUserId();
  const today = todayInTz(DEFAULT_TIMEZONE);
  const d = await dashboard(userId, today);

  const weeks: typeof d.heatmap[] = [];
  for (let i = 0; i < d.heatmap.length; i += 7) weeks.push(d.heatmap.slice(i, i + 7));
  const maxMin = Math.max(1, ...d.perTopic.map((p) => p.minutes));

  return (
    <div className="shell">
      <header className="header" style={{ textAlign: "center", paddingTop: 26 }}>
        <div className="row" style={{ justifyContent: "center", gap: 8 }}>
          <span style={{ fontSize: 34 }}>🔥</span>
          <strong style={{ fontSize: 40, color: "var(--streak-500)", lineHeight: 1 }}>
            {d.streak.currentStreak}
          </strong>
          <span style={{ fontSize: 15, fontWeight: 500, color: "var(--ink-700)" }}>日連続</span>
        </div>
        <div className="row" style={{ paddingTop: 14 }}>
          {[
            [String(d.streak.currentStreak), "現在"],
            [String(d.streak.longestStreak), "最長"],
            [String(d.streak.totalDays), "累計日数"],
            [`${(d.totalMinutes / 60).toFixed(1)}h`, "累計時間"],
          ].map(([v, l]) => (
            <div key={l} className="col grow" style={{ gap: 2, alignItems: "center" }}>
              <strong style={{ fontSize: 17 }}>{v}</strong>
              <span className="meta">{l}</span>
            </div>
          ))}
        </div>
      </header>

      <div className="body">
        <div className="card">
          <div className="row row--between">
            <strong style={{ fontSize: 13 }}>学習ヒートマップ</strong>
            <span className="meta">過去18週</span>
          </div>
          <div className="heat">
            {weeks.map((w, i) => (
              <div key={i}>
                {w.map((c) => <i key={c.date} data-l={c.level} title={`${c.date} ${c.minutes}分`} />)}
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
            <span className="meta">少</span>
            {[0, 1, 2, 3].map((l) => (
              <i key={l} style={{
                width: 11, height: 11, borderRadius: 3, display: "block",
                background: ["var(--ink-100)", "var(--brand-100)", "var(--brand-500)", "var(--brand-600)"][l],
              }} />
            ))}
            <span className="meta">多</span>
          </div>
        </div>

        <div className="card">
          <strong style={{ fontSize: 13 }}>トピック別の学習時間（今週）</strong>
          {d.perTopic.length === 0 && <span className="meta">今週の記録はまだありません</span>}
          {d.perTopic.map((p) => (
            <div key={p.topicId} className="col" style={{ gap: 5 }}>
              <div className="row">
                <TopicDot token={p.colorToken} />
                <span className="grow" style={{ fontSize: 12, fontWeight: 500 }}>{p.title}</span>
                <span className="meta" style={{ fontWeight: 700 }}>{p.minutes}分</span>
              </div>
              <div className="progress" style={{ height: 8 }}>
                <i style={{
                  width: `${(p.minutes / maxMin) * 100}%`,
                  background: `var(--${p.colorToken.replace("/", "-")})`,
                }} />
              </div>
            </div>
          ))}
        </div>

        <div className="card card--brand" style={{ gap: 6 }}>
          <span className="meta" style={{ color: "var(--brand-600)", fontWeight: 500 }}>弱点の状況</span>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip" style={{ background: "var(--ink-0)" }}>取り組み中 {d.activeWeaknesses}型</span>
            <span className="chip" style={{ background: "var(--success-100)", color: "var(--success-600)" }}>
              卒業 {d.graduatedWeaknesses}型
            </span>
          </div>
        </div>

        <div className="card">
          <strong style={{ fontSize: 13 }}>直近の学習ログ</strong>
          {d.recentSessions.length === 0 && <span className="meta">まだログがありません</span>}
          {d.recentSessions.map(({ session, topic }) => (
            <div key={session.id} className="row" style={{ alignItems: "flex-start" }}>
              <span className="meta" style={{ width: 44, flex: "none" }}>
                {session.startedAt.toISOString().slice(5, 10)}
              </span>
              <TopicDot token={topic.colorToken} />
              <span className="meta" style={{ width: 32, flex: "none" }}>{session.durationMinutes}分</span>
              <span className="grow" style={{ fontSize: 11 }}>{session.summary}</span>
            </div>
          ))}
        </div>
        <div className="grow" />
      </div>

      <TabBar active="/dashboard" />
    </div>
  );
}
