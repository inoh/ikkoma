import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { currentUserId } from "@/lib/config";
import { topicDetail } from "@/lib/services/topics";
import { listWeaknesses } from "@/lib/services/weakness";
import { TopicActions } from "@/components/TopicActions";
import { BLOCK_LABEL, Chip, Progress, TopicDot } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TopicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = currentUserId();
  const detail = await topicDetail(id);
  if (!detail || detail.topic.userId !== userId) notFound();

  const { topic, milestones, template } = detail;
  const weaknesses = (await listWeaknesses(userId, { topicId: id })).filter((w) => w.type.status === "active");
  const logs = await db.select().from(sessions)
    .where(and(eq(sessions.topicId, id), eq(sessions.state, "completed")))
    .orderBy(desc(sessions.startedAt)).limit(8);

  const currentIdx = milestones.findIndex((m) => m.completedAt === null);

  return (
    <div className="shell">
      <header className="header header--tight">
        <div className="row">
          <a href="/topics" style={{ fontSize: 18 }}>←</a>
          <TopicDot token={topic.colorToken} />
          <h1 className="h1 grow">{topic.title}</h1>
        </div>
        <span className="sub">目標: {topic.goal}</span>
        <div style={{ paddingTop: 12 }}>
          <TopicActions topicId={topic.id} status={topic.status} />
        </div>
      </header>

      <div className="body">
        <div className="card" style={{ gap: 4 }}>
          <span className="meta">現在地</span>
          <p style={{ margin: 0, fontSize: 13 }}>{topic.currentState || "（未記入）"}</p>
        </div>

        <div className="card">
          <div className="row row--between">
            <strong style={{ fontSize: 13 }}>マイルストーン</strong>
            <span className="meta">{topic.progress}%</span>
          </div>
          <Progress value={topic.progress} />
          {milestones.map((m, i) => {
            const done = m.completedAt !== null;
            const current = i === currentIdx;
            return (
              <div key={m.id} className="row" style={{
                background: current ? "var(--brand-100)" : undefined,
                padding: current ? "8px 10px" : undefined, borderRadius: 8, alignItems: "flex-start",
              }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 4, flex: "none", marginTop: 3,
                  background: done ? "var(--success-600)" : "var(--ink-0)",
                  border: `1px solid ${done ? "var(--success-600)" : "var(--ink-300)"}`,
                  color: "#fff", fontSize: 11, lineHeight: "14px", textAlign: "center",
                }}>{done ? "✓" : ""}</span>
                <span className="meta" style={{ fontWeight: 700 }}>{m.code}</span>
                <span className="grow" style={{
                  fontSize: 13, fontWeight: current ? 700 : 400,
                  color: done ? "var(--ink-500)" : undefined,
                }}>{m.title}</span>
                {current && <Chip bg="var(--brand-600)" fg="#fff">いまここ</Chip>}
              </div>
            );
          })}
        </div>

        {template.length > 0 && (
          <div className="card">
            <strong style={{ fontSize: 13 }}>定番メニュー（毎回の30分の組み立て）</strong>
            {template.map((b) => (
              <div key={b.id} className="row" style={{ alignItems: "flex-start" }}>
                <span className="chip" style={{ background: "var(--ink-100)", fontWeight: 700 }}>{b.minutes}分</span>
                <div className="col grow" style={{ gap: 1 }}>
                  <strong style={{ fontSize: 12 }}>{BLOCK_LABEL[b.blockKind] ?? b.blockKind}</strong>
                  <span className="meta">{b.instruction}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div className="row row--between">
            <strong style={{ fontSize: 13 }}>弱点 {weaknesses.length}型</strong>
            <a className="linkbtn" href="/weaknesses">すべて見る</a>
          </div>
          {weaknesses.slice(0, 5).map((w) => (
            <div key={w.type.id} className="row">
              <span className="grow" style={{ fontSize: 12 }}>{w.type.label}</span>
              <span className="meta">{w.type.occurrenceCount}回</span>
            </div>
          ))}
          {weaknesses.length === 0 && <span className="meta">まだ記録された弱点はありません</span>}
        </div>

        <div className="card">
          <strong style={{ fontSize: 13 }}>学習ログ</strong>
          {logs.length === 0 && <span className="meta">まだログがありません</span>}
          {logs.map((l) => (
            <div key={l.id} className="row" style={{ alignItems: "flex-start" }}>
              <span className="meta" style={{ width: 44, flex: "none" }}>
                {l.startedAt.toISOString().slice(5, 10)}
              </span>
              <span className="meta" style={{ width: 34, flex: "none" }}>{l.durationMinutes}分</span>
              <span className="grow" style={{ fontSize: 11 }}>{l.summary}</span>
            </div>
          ))}
        </div>
        <div className="grow" />
      </div>
    </div>
  );
}
