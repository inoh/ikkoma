"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BLOCK_LABEL } from "@/components/ui";

type Choice = { key: string; text: string };
type Attempt = {
  id: string; question: string; choices: Choice[] | null;
  userAnswer: string | null; correctAnswer: string; isCorrect: boolean | null;
  explanation: string; targetTypeIds: string[]; createdAt: string;
};
type Correction = {
  id: string; userText: string; correctedText: string;
  diff: { wrong: string; right: string; note: string }[]; feedback: string; createdAt: string;
};
type Message = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
type SessionData = {
  session: { id: string; state: string; startedAt: string };
  topic: { title: string; colorToken: string };
  item: { title: string; instruction: string; minutes: number; blockKind: string } | null;
  messages: Message[]; attempts: Attempt[]; corrections: Correction[];
};

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "失敗しました");
  return json;
}

export function SessionView({ initial }: { initial: SessionData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);

  const id = data.session.id;
  const pending = data.attempts.find((a) => a.userAnswer === null) ?? null;
  const limitSec = (data.item?.minutes ?? 30) * 60;

  useEffect(() => {
    const started = new Date(data.session.startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [data.session.startedAt]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [data]);

  const refresh = async () => setData(await (await fetch(`/api/sessions/${id}`)).json());

  const run = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const issue = run("drill", async () => { await post(`/api/sessions/${id}/drill`); await refresh(); });

  const answer = (value: string) => run("answer", async () => {
    if (!pending) return;
    await post(`/api/sessions/${id}/answer`, { attemptId: pending.id, answer: value });
    setText(""); await refresh();
  })();

  const send = run("send", async () => {
    const v = text.trim();
    if (!v) return;
    if (pending) {
      await post(`/api/sessions/${id}/answer`, { attemptId: pending.id, answer: v });
    } else {
      await post(`/api/sessions/${id}/writing`, { text: v });
    }
    setText(""); await refresh();
  });

  const finish = run("finish", async () => {
    await post(`/api/sessions/${id}/complete`);
    router.push(`/session/${id}/result`);
  });

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const over = elapsed > limitSec;

  return (
    <div className="shell">
      <header className="row" style={{ background: "var(--ink-0)", padding: "16px", borderBottom: "1px solid var(--ink-300)", gap: 10 }}>
        <button onClick={() => router.push("/")} style={{ fontSize: 18 }}>←</button>
        <div className="col grow" style={{ gap: 2 }}>
          <strong style={{ fontSize: 15 }}>
            {data.topic.title} ・ {BLOCK_LABEL[data.item?.blockKind ?? ""] ?? "学習"}
          </strong>
          <span className="meta">{data.item?.title}</span>
        </div>
        <span className="chip" style={{ background: over ? "var(--warning-100)" : "var(--ink-100)", color: over ? "var(--warning-600)" : "var(--ink-700)" }}>
          ⏱ {mmss(elapsed)} / {mmss(limitSec)}
        </span>
      </header>

      <div className="body chat">
        {data.messages.map((m) => (
          <div key={m.id} className={`bubble bubble--${m.role === "user" ? "user" : "ai"}`}>{m.content}</div>
        ))}

        {data.attempts.map((a) => (
          <div key={a.id} className="col" style={{ gap: 8 }}>
            <div className="card">
              <span className="meta">Q{data.attempts.indexOf(a) + 1}</span>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 500, whiteSpace: "pre-wrap" }}>{a.question}</p>
              {a.choices?.map((c) => {
                const answered = a.userAnswer !== null;
                const isPick = a.userAnswer === c.key;
                const isRight = a.correctAnswer === c.key;
                return (
                  <button key={c.key} className="choice"
                    data-selected={!answered && isPick}
                    data-correct={answered && isRight}
                    data-wrong={answered && isPick && !isRight}
                    disabled={answered || busy !== null}
                    onClick={() => answer(c.key)}>
                    <b>{c.key}</b><span>{c.text}</span>
                  </button>
                );
              })}
              {!a.choices && a.userAnswer === null && (
                <span className="meta">記述式です。下の入力欄から答えてください。</span>
              )}
            </div>

            {a.userAnswer !== null && (
              <>
                <div className="bubble bubble--user">{a.userAnswer}</div>
                <div className={`card ${a.isCorrect ? "card--success" : "card--danger"}`} style={{ gap: 4 }}>
                  <strong style={{ fontSize: 13, color: a.isCorrect ? "var(--success-600)" : "var(--danger-600)" }}>
                    {a.isCorrect ? "✓ 正解" : `✗ 不正解（正解: ${a.correctAnswer}）`}
                  </strong>
                  <p className="sub" style={{ margin: 0, color: "var(--ink-700)" }}>{a.explanation}</p>
                </div>
              </>
            )}
          </div>
        ))}

        {data.corrections.map((c) => (
          <div key={c.id} className="card" style={{ gap: 8 }}>
            <span className="meta">添削</span>
            <p className="mono" style={{ margin: 0, color: "var(--ink-500)" }}>{c.userText}</p>
            <p className="mono" style={{ margin: 0, color: "var(--success-600)" }}>{c.correctedText}</p>
            {c.diff.map((d, i) => (
              <div key={i} className="col" style={{ gap: 0, background: "var(--ink-50)", padding: "8px 10px", borderRadius: 8 }}>
                <span className="mono" style={{ color: "var(--danger-600)" }}>× {d.wrong}</span>
                <span className="mono" style={{ color: "var(--success-600)" }}>○ {d.right}</span>
                <span className="meta">{d.note}</span>
              </div>
            ))}
            <p className="sub" style={{ margin: 0, color: "var(--ink-700)" }}>{c.feedback}</p>
          </div>
        ))}

        {error && <p className="error">{error}</p>}
        <div ref={bottom} />

        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button className="btn btn--sm btn--ghost" onClick={issue} disabled={busy !== null || pending !== null}>
            {busy === "drill" ? "出題中…" : "問題を出す"}
          </button>
          <div className="grow" />
          <button className="btn btn--sm" onClick={finish} disabled={busy !== null}>
            {busy === "finish" ? "まとめています…" : "セッションを完了"}
          </button>
        </div>
      </div>

      <div className="inputbar">
        <textarea rows={1} value={text} placeholder={pending ? "答えを入力" : "英文や説明を書くと添削します"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
        <button className="btn btn--sm" onClick={send} disabled={busy !== null || text.trim() === ""}>
          {busy === "send" ? "…" : "送信"}
        </button>
      </div>
    </div>
  );
}
