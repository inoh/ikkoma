import { currentUserId, DEFAULT_TIMEZONE } from "@/lib/config";
import { todayInTz } from "@/lib/domain/menu";
import { INTERVALS } from "@/lib/domain/review";
import { listWeaknesses } from "@/lib/services/weakness";
import { TabBar } from "@/components/TabBar";
import { Empty, TopicDot } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function WeaknessesPage() {
  const userId = currentUserId();
  const today = todayInTz(DEFAULT_TIMEZONE);
  const all = await listWeaknesses(userId);

  const active = all.filter((w) => w.type.status === "active" && w.type.approved);
  const pending = all.filter((w) => w.type.status === "active" && !w.type.approved);
  const mastered = all.filter((w) => w.type.status === "mastered");
  const due = active.filter((w) => w.review && w.review.dueOn <= today);

  return (
    <div className="shell">
      <header className="header">
        <div className="row row--between">
          <h1 className="h1">弱点リスト</h1>
          <span className="meta">発生回数順</span>
        </div>
        <div style={{ paddingTop: 12 }}>
          <div className="card card--brand" style={{ flexDirection: "row", alignItems: "center" }}>
            <div className="col grow" style={{ gap: 1 }}>
              <strong style={{ fontSize: 14, color: "var(--brand-600)" }}>今日の復習 {due.length}件</strong>
              <span className="meta">間隔反復の期限が来た型です</span>
            </div>
            <a href="/"><button className="btn btn--sm">今日のメニューへ</button></a>
          </div>
        </div>
      </header>

      <div className="body">
        {active.length === 0 && pending.length === 0 && (
          <Empty>まだ弱点は記録されていません。<br />セッションの添削から自動で溜まっていきます。</Empty>
        )}

        {pending.length > 0 && (
          <div className="card card--warning" style={{ gap: 2 }}>
            <strong style={{ fontSize: 12, color: "var(--warning-600)" }}>未承認 {pending.length}件</strong>
            <span className="meta">
              セッション結果画面で承認すると復習キューに入ります: {pending.map((p) => p.type.label).join(" / ")}
            </span>
          </div>
        )}

        {active.map((w) => {
          const level = (w.review?.intervalStep ?? 0) + 1;
          const isDue = w.review ? w.review.dueOn <= today : false;
          return (
            <div key={w.type.id} className="card">
              <div className="row">
                <strong className="grow" style={{ fontSize: 14 }}>{w.type.label}</strong>
                <span className="row" style={{ gap: 3 }}>
                  {Array.from({ length: Math.min(w.type.occurrenceCount, 5) }).map((_, i) => (
                    <i key={i} className="dot" style={{
                      background: w.type.occurrenceCount >= 3 ? "var(--danger-600)" : "var(--warning-600)",
                    }} />
                  ))}
                  <span className="meta">{w.type.occurrenceCount}回</span>
                </span>
              </div>
              {w.type.description && <p className="sub" style={{ margin: 0 }}>{w.type.description}</p>}
              {(w.type.exampleWrong || w.type.exampleRight) && (
                <div className="col" style={{ gap: 0, background: "var(--ink-50)", padding: "8px 10px", borderRadius: 8 }}>
                  {w.type.exampleWrong && <span className="mono" style={{ color: "var(--danger-600)" }}>× {w.type.exampleWrong}</span>}
                  {w.type.exampleRight && <span className="mono" style={{ color: "var(--success-600)" }}>○ {w.type.exampleRight}</span>}
                </div>
              )}
              <div className="row">
                <TopicDot token={w.topicColor} />
                <span className="meta grow">{w.topicTitle}</span>
                <span className="meta" style={{ color: isDue ? "var(--brand-600)" : undefined, fontWeight: isDue ? 700 : 400 }}>
                  次回 {isDue ? "今日" : w.review?.dueOn.slice(5).replace("-", "/")}
                </span>
                <span className="row" style={{ gap: 2 }}>
                  {INTERVALS.map((_, i) => (
                    <i key={i} style={{
                      width: 8, height: 5, borderRadius: 2, display: "block",
                      background: i < level ? "var(--brand-600)" : "var(--ink-300)",
                    }} />
                  ))}
                  <span className="meta">Lv{level}</span>
                </span>
              </div>
            </div>
          );
        })}

        {mastered.length > 0 && (
          <div className="card card--muted" style={{ gap: 2 }}>
            <strong style={{ fontSize: 12 }}>✨ 卒業した型 ({mastered.length})</strong>
            <span className="meta">{mastered.map((m) => m.type.label).join(" / ")}</span>
          </div>
        )}
        <div className="grow" />
      </div>

      <TabBar active="/weaknesses" />
    </div>
  );
}
