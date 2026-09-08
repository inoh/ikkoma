import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUserId } from "@/lib/config";
import { summarize } from "@/lib/services/session";
import { WeaknessApproval } from "@/components/WeaknessApproval";
import { Chip } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = currentUserId();

  let r: Awaited<ReturnType<typeof summarize>>;
  try { r = await summarize(id, userId); } catch { notFound(); }

  return (
    <div className="shell">
      <header className="header" style={{ textAlign: "center", paddingTop: 32 }}>
        <h1 className="h1" style={{ marginBottom: 8 }}>セッション完了 🎉</h1>
        <div className="row" style={{ justifyContent: "center" }}>
          <Chip bg="var(--brand-100)" fg="var(--brand-600)">{r.topic.title}</Chip>
          <Chip>{r.session.durationMinutes ?? 0}分</Chip>
          {r.score.total > 0 && (
            <Chip bg="var(--success-100)" fg="var(--success-600)">
              正答 {r.score.correct}/{r.score.total}
            </Chip>
          )}
        </div>
      </header>

      <div className="body">
        {r.session.summary && (
          <div className="card" style={{ gap: 2 }}>
            <span className="meta">学習ログに記録しました</span>
            <strong style={{ fontSize: 14 }}>{r.session.summary}</strong>
          </div>
        )}

        <h2 className="h3">今日みつかったミスの型</h2>
        <WeaknessApproval items={r.pendingTypes.map((t) => ({
          id: t.id, label: t.label, description: t.description,
          exampleWrong: t.exampleWrong, exampleRight: t.exampleRight, occurrenceCount: t.occurrenceCount,
        }))} />

        {r.graduated.length > 0 && (
          <div className="card card--success" style={{ gap: 2 }}>
            <strong style={{ fontSize: 13, color: "var(--success-600)" }}>
              ✨ 卒業した型： {r.graduated.map((g) => g.label).join(" / ")}
            </strong>
            <span className="meta">復習キューから外れました</span>
          </div>
        )}

        {r.nextAction && (
          <div className="card" style={{ gap: 2 }}>
            <span className="meta">次の一手</span>
            <strong style={{ fontSize: 14 }}>{r.nextAction}</strong>
          </div>
        )}

        <div className="grow" />

        {r.streak && (
          <div className="card" style={{ background: "var(--streak-100)", border: "none", alignItems: "center" }}>
            <strong style={{ color: "var(--streak-500)", fontSize: 13 }}>
              🔥 ストリークが {r.streak.currentStreak}日 に更新されました
            </strong>
          </div>
        )}
        <Link href="/"><button className="btn">完了</button></Link>
      </div>
    </div>
  );
}
