"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BLOCK_LABEL } from "@/components/ui";

type Milestone = { code: string; title: string; detail: string };
type Proposal = {
  topicTitle: string; milestones: Milestone[];
  menuTemplate: { blockKind: string; minutes: number; instruction: string }[];
  currentState: string; firstNextAction: string;
};

const STEPS = ["目標", "現在地", "提案の確認"];

export function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState("");
  const [selfReport, setSelfReport] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const call = async (url: string, method: string, body: unknown) => {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "失敗しました");
    return json;
  };

  const propose = async () => {
    setBusy(true); setError(null);
    try {
      setProposal(await call("/api/onboarding", "PUT", { goal, selfReport, dailyMinutes: 30 }));
      setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!proposal) return;
    setBusy(true); setError(null);
    try {
      const r = await call("/api/onboarding", "POST", { ...proposal, goal });
      if (r.warning) { setWarning(r.warning); return; }
      router.push("/");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const editMilestone = (i: number, patch: Partial<Milestone>) => {
    if (!proposal) return;
    const ms = proposal.milestones.map((m, idx) => (idx === i ? { ...m, ...patch } : m));
    setProposal({ ...proposal, milestones: ms });
  };

  return (
    <div className="shell">
      <header className="header">
        <div className="row" style={{ gap: 6 }}>
          {STEPS.map((_, i) => (
            <span key={i} style={{
              flex: 1, height: 4, borderRadius: 999,
              background: i <= step ? "var(--brand-600)" : "var(--ink-300)",
            }} />
          ))}
        </div>
        <div className="row row--between" style={{ paddingTop: 10 }}>
          <span className="meta">ステップ {step + 1} / {STEPS.length}</span>
          <a className="meta" href="/">やめる</a>
        </div>
      </header>

      <div className="body">
        {step === 0 && (
          <>
            <h1 className="h1">何を学びたいですか？</h1>
            <p className="sub">目標を1つだけ、具体的に。あとから編集できます。</p>
            <input className="field" autoFocus value={goal} onChange={(e) => setGoal(e.target.value)}
              placeholder="例: TOEIC 600点を取りたい" />
            <div className="grow" />
            <button className="btn" disabled={goal.trim().length < 3} onClick={() => setStep(1)}>次へ</button>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="h1">いまの現在地は？</h1>
            <p className="sub">
              分かる範囲で構いません。ここが空だと毎日のメニュー精度が落ちるので、
              ざっくりでも書いておくのを勧めます。
            </p>
            <textarea className="field" rows={5} autoFocus value={selfReport}
              onChange={(e) => setSelfReport(e.target.value)}
              placeholder="例: 受験歴なし。中学英語はなんとなく分かるが、文法は感覚で解いている" />
            {error && <p className="error">{error}</p>}
            <div className="grow" />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--ghost" onClick={() => setStep(0)}>戻る</button>
              <button className="btn" disabled={busy} onClick={propose}>
                {busy ? "マイルストーンを設計しています…" : "AI に分解してもらう"}
              </button>
            </div>
          </>
        )}

        {step === 2 && proposal && (
          <>
            <h1 className="h1">マイルストーンを提案しました</h1>
            <p className="sub">編集は自由です。AI の提案よりあなたの編集が常に優先されます。</p>

            <div className="card card--brand" style={{ gap: 2 }}>
              <span className="meta" style={{ color: "var(--brand-600)" }}>トピック名</span>
              <input className="field" value={proposal.topicTitle}
                onChange={(e) => setProposal({ ...proposal, topicTitle: e.target.value })} />
            </div>

            {proposal.milestones.map((m, i) => (
              <div key={i} className="card" style={{ gap: 4 }}>
                <div className="row">
                  <span className="chip">{m.code}</span>
                  <input className="field" style={{ padding: "6px 10px", fontSize: 14, fontWeight: 700 }}
                    value={m.title} onChange={(e) => editMilestone(i, { title: e.target.value })} />
                </div>
                {m.detail && <p className="sub" style={{ margin: 0 }}>{m.detail}</p>}
              </div>
            ))}

            <div className="card" style={{ gap: 4 }}>
              <strong style={{ fontSize: 13 }}>定番メニュー（毎回の30分）</strong>
              {proposal.menuTemplate.map((b, i) => (
                <div key={i} className="row" style={{ alignItems: "flex-start" }}>
                  <span className="chip" style={{ fontWeight: 700 }}>{b.minutes}分</span>
                  <div className="col grow" style={{ gap: 1 }}>
                    <strong style={{ fontSize: 12 }}>{BLOCK_LABEL[b.blockKind] ?? b.blockKind}</strong>
                    <span className="meta">{b.instruction}</span>
                  </div>
                </div>
              ))}
            </div>

            {warning && <p className="error" style={{ background: "var(--warning-100)", borderColor: "var(--warning-600)", color: "var(--warning-600)" }}>{warning}</p>}
            {error && <p className="error">{error}</p>}
            <div className="grow" />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn--ghost" onClick={() => setStep(1)}>戻る</button>
              <button className="btn" disabled={busy} onClick={commit}>
                {busy ? "保存しています…" : warning ? "それでも追加する" : "この内容で始める"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
