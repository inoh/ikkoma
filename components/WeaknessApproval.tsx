"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Pending = {
  id: string; label: string; description: string;
  exampleWrong: string | null; exampleRight: string | null; occurrenceCount: number;
};

export function WeaknessApproval({ items }: { items: Pending[] }) {
  const router = useRouter();
  const [done, setDone] = useState<Record<string, "approved" | "rejected">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (id: string, action: "approve" | "reject") => {
    setBusy(id);
    try {
      await fetch(`/api/weaknesses/${id}/${action}`, { method: "POST" });
      setDone((d) => ({ ...d, [id]: action === "approve" ? "approved" : "rejected" }));
      router.refresh();
    } finally { setBusy(null); }
  };

  if (items.length === 0) {
    return <p className="sub">今回みつかった新しいミスの型はありません。</p>;
  }

  return (
    <>
      {items.map((w) => {
        const state = done[w.id];
        const recurring = w.occurrenceCount > 1;
        return (
          <div key={w.id} className="card" style={{ opacity: state ? 0.55 : 1 }}>
            <div className="row">
              <span className="chip" style={{
                background: recurring ? "var(--danger-100)" : "var(--warning-100)",
                color: recurring ? "var(--danger-600)" : "var(--warning-600)",
              }}>
                {recurring ? "再発" : "新規"}
              </span>
              <strong className="grow" style={{ fontSize: 14 }}>{w.label}</strong>
              <span className="meta">{recurring ? `${w.occurrenceCount}回目` : "初回"}</span>
            </div>
            {w.description && <p className="sub" style={{ margin: 0 }}>{w.description}</p>}
            {(w.exampleWrong || w.exampleRight) && (
              <div className="col" style={{ gap: 0, background: "var(--ink-50)", padding: "8px 10px", borderRadius: 8 }}>
                {w.exampleWrong && <span className="mono" style={{ color: "var(--danger-600)" }}>× {w.exampleWrong}</span>}
                {w.exampleRight && <span className="mono" style={{ color: "var(--success-600)" }}>○ {w.exampleRight}</span>}
              </div>
            )}
            {state ? (
              <span className="meta">{state === "approved" ? "✓ 承認しました。復習キューに入りました" : "却下しました"}</span>
            ) : (
              <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
                <button className="btn btn--sm btn--ghost" disabled={busy !== null} onClick={() => act(w.id, "reject")}>却下</button>
                <button className="btn btn--sm" disabled={busy !== null} onClick={() => act(w.id, "approve")}>承認</button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
