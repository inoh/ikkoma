"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "失敗しました");
  return json;
}

export function TodayActions({ hasMenu, firstItemId }: { hasMenu: boolean; firstItemId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const start = run("start", async () => {
    if (!firstItemId) return;
    const s = await post("/api/sessions", { menuItemId: firstItemId });
    router.push(`/session/${s.id}`);
  });

  const generate = run("gen", async () => {
    await post(`/api/menu/generate${hasMenu ? "?force=1" : ""}`);
    router.refresh();
  });

  const shrink = run("shrink", async () => {
    await post("/api/menu/shrink");
    router.refresh();
  });

  return (
    <div className="col" style={{ gap: 10 }}>
      {error && <p className="error">{error}</p>}
      {hasMenu ? (
        <>
          <button className="btn" onClick={start} disabled={busy !== null || !firstItemId}>
            {busy === "start" ? "開始しています…" : "今日の学習を始める"}
          </button>
          <div className="row" style={{ justifyContent: "center", gap: 16 }}>
            <button className="linkbtn" onClick={generate} disabled={busy !== null}>
              {busy === "gen" ? "組み直しています…" : "組み直す"}
            </button>
            <span style={{ color: "var(--ink-300)" }}>・</span>
            <button className="linkbtn" onClick={shrink} disabled={busy !== null}>
              {busy === "shrink" ? "短縮しています…" : "今日は5分だけ"}
            </button>
          </div>
        </>
      ) : (
        <button className="btn" onClick={generate} disabled={busy !== null}>
          {busy === "gen" ? "メニューを生成しています…" : "今日のメニューを生成する"}
        </button>
      )}
    </div>
  );
}
