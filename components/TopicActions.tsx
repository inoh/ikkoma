"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function TopicActions({ topicId, status }: { topicId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const act = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(true); setNote(null);
    try {
      const res = await fetch(`/api/topics/${topicId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (action === "resume" && json?.needsRecheck) {
        setNote(`${json.gapDays}日空いています。次のセッションは現在地の再確認から始めましょう。`);
      }
      router.refresh();
    } finally { setBusy(false); }
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        {status === "active" && (
          <button className="btn btn--sm btn--ghost" disabled={busy}
            onClick={() => act("pause", { reason: prompt("中断の理由（後で再開判断に使います）") ?? "" })}>
            中断する
          </button>
        )}
        {status === "paused" && (
          <button className="btn btn--sm" disabled={busy} onClick={() => act("resume")}>再開する</button>
        )}
        {status !== "done" && (
          <button className="btn btn--sm btn--ghost" disabled={busy} onClick={() => act("complete")}>
            完了にする
          </button>
        )}
      </div>
      {note && <p className="sub" style={{ color: "var(--warning-600)" }}>{note}</p>}
    </div>
  );
}
