/**
 * study リポジトリの Markdown を Ikkoma の DB に取り込む。
 * docs/07-roadmap.md「Phase 1 の移行」に対応。
 *
 *   STUDY_REPO_PATH=~/Documents/workspace/study npm run db:import-study
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import {
  milestones, notificationSettings, reviewState, rhythmPhases, rhythmSlots,
  streaks, topicMenuTemplates, topics, users, weaknessTypes,
} from "../lib/db/schema";
import { initialReviewState } from "../lib/domain/review";

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
  weaknesses: string[];
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

  const weaknesses: string[] = [];
  for (const line of section(md, "弱点リスト").split("\n")) {
    const m = line.match(/^- \[[ x]\] (.+)$/);
    if (m) weaknesses.push(m[1].replace(/\*\*/g, "").replace(/※.*$/, "").trim());
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
    milestones: ms, weaknesses, nextActions, menuTemplate,
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
    for (const label of parsed.weaknesses) {
      const [head, ...rest] = label.split(/[（(]/);
      const [w] = await db.insert(weaknessTypes).values({
        userId: user.id, topicId: t.id,
        label: head.trim(),
        description: rest.join("(").replace(/[)）]\s*$/, "").trim(),
        origin: "manual", approved: true, occurrenceCount: label.includes("再発") ? 2 : 1,
      }).returning();
      await db.insert(reviewState).values({ typeId: w.id, ...initialReviewState(TODAY) });
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
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
