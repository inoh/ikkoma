/**
 * study リポジトリの Markdown を Ikkoma の DB に取り込む。
 * docs/07-roadmap.md「Phase 1 の移行」に対応。
 *
 *   STUDY_REPO_PATH=~/Documents/workspace/study npm run db:import-study
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { eq } from "drizzle-orm";

// DB モジュールを読む前に .env をロードする（リポジトリ基準。cwd に依存させない）
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile?.(join(repoRoot, ".env")); } catch { /* env は外から渡されている */ }

const { db } = await import("../lib/db");
const {
  milestones, notificationSettings, reviewState, rhythmPhases, rhythmSlots,
  sessions, streaks, topicMenuTemplates, topics, users, weaknessTypes,
} = await import("../lib/db/schema");
const { initialReviewState } = await import("../lib/domain/review");

const REPO = (process.env.STUDY_REPO_PATH ?? join(homedir(), "Documents/workspace/study"))
  .replace(/^~/, homedir());
const EMAIL = process.env.IKKOMA_EMAIL ?? "syslink.h.inoue@gmail.com";
const TODAY = new Date().toISOString().slice(0, 10);

/**
 * 見出し直下の本文を返す。
 * 正規表現の `$` は m フラグ下で行末にもマッチしてしまい lazy 量指定子が即座に打ち切られるため、
 * 行ベースで切り出す。
 */
function section(md: string, heading: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${heading}`));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) { end = i; break; }
  }
  return lines.slice(start + 1, end).join("\n");
}
function field(md: string, label: string): string | null {
  const m = md.match(new RegExp(`^- ${label}: (.+)$`, "m"));
  if (!m) return null;
  return m[1].replace(/\*\*/g, "").trim();
}

type ParsedTopic = {
  title: string; goal: string; status: "active" | "paused" | "done";
  currentState: string; progress: number;
  milestones: { code: string; title: string; detail: string; done: boolean }[];
  weaknesses: {
    label: string; description: string; occurrenceCount: number;
    exampleWrong: string | null; exampleRight: string | null;
  }[];
  logs: { date: string; minutes: number; summary: string }[];
  nextActions: string[];
  menuTemplate: { blockKind: "drill" | "writing_check"; minutes: number; instruction: string }[];
};

function parseTopic(md: string): ParsedTopic {
  const title = md.match(/^# (.+)$/m)?.[1].replace(/\s*\(.*\)$/, "").trim() ?? "untitled";
  const statusRaw = field(md, "ステータス") ?? "active";
  const status = (["active", "paused", "done"].includes(statusRaw) ? statusRaw : "active") as ParsedTopic["status"];

  const ms: ParsedTopic["milestones"] = [];
  const msSection = section(md, "マイルストーン");
  for (const line of msSection.split("\n")) {
    const m = line.match(/^- \[([ x])\] \*{0,2}(M\d+): ([^*←]+)/);
    if (m) ms.push({ done: m[1] === "x", code: m[2], title: m[3].replace(/\*\*/g, "").trim(), detail: "" });
  }

  const weaknesses: ParsedTopic["weaknesses"] = [];
  for (const line of section(md, "弱点リスト").split("\n")) {
    const m = line.match(/^- \[[ x]\] (.+)$/);
    if (!m) continue;
    const raw = m[1].replace(/\*\*/g, "");
    // 「※…にも再発」の注記は発生回数と例文を持っているので、捨てる前に拾う
    const note = raw.match(/※(.*)$/)?.[1] ?? "";
    const body = raw.replace(/※.*$/, "").trim();
    const [head, ...rest] = body.split(/[（(]/);
    // 「× checked mail → checked the email」形式の例。
    // 正解の後ろに解説が続くことがあるので最初の文で切る。
    const ex = (note + body).match(/×\s*([^→)）]+?)\s*→\s*([^)）]+)/);
    const trim = (v: string | undefined) =>
      v ? v.split(/[。．]/)[0].replace(/^[○×]\s*/, "").trim() || null : null;
    weaknesses.push({
      label: head.trim(),
      description: rest.join("(").replace(/[)）]\s*$/, "").trim(),
      occurrenceCount: /再発/.test(note) ? 2 : 1,
      exampleWrong: trim(ex?.[1]),
      exampleRight: trim(ex?.[2]),
    });
  }

  // 学習ログ表: | 2026-09-06 | 45分 | 内容 |
  const logs: ParsedTopic["logs"] = [];
  for (const line of section(md, "学習ログ").split("\n")) {
    const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*(\d+)\s*分\s*\|\s*(.+?)\s*\|$/);
    if (m) logs.push({ date: m[1], minutes: Number(m[2]), summary: m[3].trim() });
  }

  const nextActions: string[] = [];
  for (const line of section(md, "次の一手").split("\n")) {
    const m = line.match(/^\d+\.\s+(.+)$/);
    if (m) nextActions.push(m[1].replace(/\*\*/g, "").trim());
  }

  // 「定番メニュー」があれば拾う。無ければ汎用の型を当てる
  const tmplSection = section(md, "定番メニュー");
  const menuTemplate: ParsedTopic["menuTemplate"] = tmplSection.includes("英作文")
    ? [
        { blockKind: "drill", minutes: 20, instruction: "その日のテーマの問題を出題・解説する（10問）" },
        { blockKind: "writing_check", minutes: 10, instruction: "学んだ文法・単語を使って英文を2〜3個作らせ、添削する" },
      ]
    : [
        { blockKind: "drill", minutes: 20, instruction: "対象範囲を読み、要点を整理する" },
        { blockKind: "writing_check", minutes: 10, instruction: "学んだ内容を自分の言葉で説明させ、抜けを指摘する" },
      ];

  return {
    title, status,
    goal: field(md, "目標") ?? title,
    currentState: field(md, "現在地") ?? "",
    progress: Number((field(md, "進捗") ?? "0").replace("%", "")) || 0,
    milestones: ms, weaknesses, logs, nextActions, menuTemplate,
  };
}

const COLORS = ["topic/1", "topic/2", "topic/3", "topic/4", "topic/5", "topic/6"];

async function main() {
  if (!existsSync(join(REPO, "topics"))) {
    throw new Error(`study リポジトリが見つかりません: ${REPO}\nSTUDY_REPO_PATH を指定してください`);
  }

  const [user] = await db.insert(users)
    .values({ email: EMAIL, displayName: "井上", timezone: "Asia/Tokyo", dailyGoalMinutes: 30 })
    .onConflictDoUpdate({ target: users.email, set: { displayName: "井上" } })
    .returning();

  // 冪等にするため既存トピックを消してから入れ直す
  await db.delete(topics).where(eq(topics.userId, user.id));

  const files = readdirSync(join(REPO, "topics")).filter((f) => f.endsWith(".md"));
  const created: { id: string; title: string; status: string }[] = [];
  let importedLogs = 0;

  for (const [i, file] of files.entries()) {
    const parsed = parseTopic(readFileSync(join(REPO, "topics", file), "utf8"));

    const [t] = await db.insert(topics).values({
      userId: user.id, title: parsed.title, goal: parsed.goal, status: parsed.status,
      currentState: parsed.currentState, progress: parsed.progress,
      nextActions: parsed.nextActions, colorToken: COLORS[i % COLORS.length],
    }).returning();

    if (parsed.milestones.length) {
      await db.insert(milestones).values(parsed.milestones.map((m, idx) => ({
        topicId: t.id, code: m.code, title: m.title, detail: m.detail || null,
        orderIndex: idx, completedAt: m.done ? new Date() : null,
      })));
    }
    await db.insert(topicMenuTemplates).values(parsed.menuTemplate.map((b, idx) => ({
      topicId: t.id, blockKind: b.blockKind, minutes: b.minutes, instruction: b.instruction, orderIndex: idx,
    })));

    // 弱点リストは承認済みとして取り込み、その日から間隔反復に乗せる
    for (const wk of parsed.weaknesses) {
      const [w] = await db.insert(weaknessTypes).values({
        userId: user.id, topicId: t.id,
        label: wk.label, description: wk.description,
        exampleWrong: wk.exampleWrong, exampleRight: wk.exampleRight,
        origin: "manual", approved: true, occurrenceCount: wk.occurrenceCount,
      }).returning();
      await db.insert(reviewState).values({ typeId: w.id, ...initialReviewState(TODAY) });
    }

    // 学習ログを完了済みセッションとして取り込む（ヒートマップと累計時間の元になる）
    if (parsed.logs.length) {
      await db.insert(sessions).values(parsed.logs.map((l) => ({
        userId: user.id, topicId: t.id, state: "completed" as const,
        summary: l.summary, durationMinutes: l.minutes,
        // 時刻は記録されていないので JST 正午に置く
        startedAt: new Date(`${l.date}T12:00:00+09:00`),
        endedAt: new Date(`${l.date}T12:00:00+09:00`),
      })));
      importedLogs += parsed.logs.length;
    }

    created.push({ id: t.id, title: t.title, status: t.status });
  }

  // 週次リズム（フェーズ1: AgentCore 厚め）
  const actives = created.filter((c) => c.status === "active");
  if (actives.length >= 2) {
    const [phase] = await db.insert(rhythmPhases).values({
      userId: user.id, name: "フェーズ1（AgentCore 厚め）", isActive: true,
      switchCondition: "AgentCore の M2 完了",
    }).returning();
    const ac = actives.find((a) => /agent/i.test(a.title)) ?? actives[0];
    const lang = actives.find((a) => a.id !== ac.id) ?? actives[0];
    // 0=日 .. 6=土
    const plan: [number, string, "main" | "weekly_review"][] = [
      [1, ac.id, "main"], [2, lang.id, "main"], [3, ac.id, "main"], [4, lang.id, "main"],
      [5, ac.id, "main"], [6, ac.id, "main"], [0, lang.id, "weekly_review"],
    ];
    await db.insert(rhythmSlots).values(plan.map(([weekday, topicId, role]) => ({
      phaseId: phase.id, weekday, topicId, role,
    })));
    // AgentCore の日も冒頭5分は語学を混ぜる
    await db.insert(rhythmSlots).values([1, 3, 5, 6].map((weekday) => ({
      phaseId: phase.id, weekday, topicId: lang.id, role: "warmup" as const,
    })));
  }

  // DASHBOARD.md からストリークを引き継ぐ
  const dash = existsSync(join(REPO, "DASHBOARD.md"))
    ? readFileSync(join(REPO, "DASHBOARD.md"), "utf8") : "";
  const num = (label: string) => Number(dash.match(new RegExp(`- ${label}: (\\d+)日`))?.[1] ?? 0);
  const lastStudied = dash.match(/\| (\d{4}-\d{2}-\d{2}) \| ✅/)?.[1] ?? null;
  const s = {
    currentStreak: num("現在のストリーク"),
    longestStreak: num("最長ストリーク"),
    totalDays: num("累計学習日数"),
    lastStudiedOn: lastStudied,
  };
  await db.insert(streaks).values({ userId: user.id, ...s })
    .onConflictDoUpdate({ target: streaks.userId, set: s });

  await db.insert(notificationSettings).values([
    { userId: user.id, kind: "noon" as const, time: "12:00", channel: "web_push" as const },
    { userId: user.id, kind: "night" as const, time: "21:00", channel: "web_push" as const },
  ]).onConflictDoNothing();

  console.log("取り込み完了");
  console.log(`  user id : ${user.id}   ← .env の IKKOMA_USER_ID に入れてください`);
  console.log(`  topics  : ${created.map((c) => `${c.title}(${c.status})`).join(", ")}`);
  console.log(`  streak  : 現在${s.currentStreak}日 / 最長${s.longestStreak}日 / 累計${s.totalDays}日`);
  console.log(`  logs    : ${importedLogs}件の学習ログをセッションとして取り込み`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
