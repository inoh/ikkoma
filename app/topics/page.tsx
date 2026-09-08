import Link from "next/link";
import { currentUserId } from "@/lib/config";
import { listTopics } from "@/lib/services/topics";
import { listWeaknesses } from "@/lib/services/weakness";
import { TabBar } from "@/components/TabBar";
import { Chip, Empty, Progress, TopicDot } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS = {
  active: { label: "active", bg: "var(--success-100)", fg: "var(--success-600)" },
  paused: { label: "paused", bg: "var(--ink-300)", fg: "var(--ink-700)" },
  done: { label: "done", bg: "var(--brand-100)", fg: "var(--brand-600)" },
} as const;

export default async function TopicsPage() {
  const userId = currentUserId();
  const [topics, weaknesses] = await Promise.all([listTopics(userId), listWeaknesses(userId)]);
  const weakCount = new Map<string, number>();
  for (const w of weaknesses) {
    if (w.type.status !== "active") continue;
    weakCount.set(w.type.topicId, (weakCount.get(w.type.topicId) ?? 0) + 1);
  }
  const activeCount = topics.filter((t) => t.status === "active").length;

  return (
    <div className="shell">
      <header className="header">
        <h1 className="h1">トピック</h1>
        <span className="sub">active は2つまで。3つ目は週次配分が破綻しやすい</span>
      </header>

      <div className="body">
        {topics.length === 0 && <Empty>まだトピックがありません。</Empty>}

        {topics.map((t) => {
          const s = STATUS[t.status];
          const dim = t.status !== "active";
          return (
            <Link key={t.id} href={`/topics/${t.id}`}>
              <div className={`card${dim ? " card--muted" : ""}`}>
                <div className="row">
                  <TopicDot token={t.colorToken} />
                  <strong className="grow" style={{ fontSize: 16, color: dim ? "var(--ink-500)" : undefined }}>
                    {t.title}
                  </strong>
                  <Chip bg={s.bg} fg={s.fg}>{s.label}</Chip>
                </div>
                <p className="sub" style={{ margin: 0 }}>{t.goal}</p>
                <div className="row">
                  <div className="grow"><Progress value={t.progress} /></div>
                  <span className="meta">{t.progress}%</span>
                </div>
                <span className="meta">
                  弱点 {weakCount.get(t.id) ?? 0}型
                  {t.status === "paused" && t.pausedReason ? ` ・ 中断理由: ${t.pausedReason}` : ""}
                </span>
              </div>
            </Link>
          );
        })}

        <Link href="/onboarding"><button className="btn btn--dashed">＋ トピックを追加</button></Link>

        {activeCount >= 2 && (
          <div className="card card--warning" style={{ gap: 2 }}>
            <strong style={{ fontSize: 12, color: "var(--warning-600)" }}>active が2つあります</strong>
            <span className="meta">
              3つ目を追加すると週次リズムが破綻しやすくなります。どれかを中断してから追加することを勧めます。
            </span>
          </div>
        )}
        <div className="grow" />
      </div>

      <TabBar active="/topics" />
    </div>
  );
}
