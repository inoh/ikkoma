#!/usr/bin/env node
/**
 * Ikkoma MCP サーバー（stdio）。
 *
 * AI を持たないのが要点。学習の思考は接続元（Claude Code など）のモデルが行い、
 * このサーバーは「材料を渡す」「結果を検証して保存する」だけを担う。
 * 検証は API 経由と同じ lib/domain の関数を通るので、どちらの経路でも品質保証は変わらない。
 *
 *   node --env-file=.env node_modules/.bin/tsx mcp/server.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// .env をロードしてから DB モジュールを読む（DATABASE_URL が必要なため）。
// MCP クライアントは任意の cwd から起動してくるので、リポジトリ基準で解決する。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile?.(join(repoRoot, ".env")); } catch { /* env は外から渡されている */ }

const { currentUserId, DEFAULT_TIMEZONE } = await import("../lib/config");
const { todayInTz } = await import("../lib/domain/menu");
const menuSvc = await import("../lib/services/menu");
const sessionSvc = await import("../lib/services/session");
const weaknessSvc = await import("../lib/services/weakness");
const topicSvc = await import("../lib/services/topics");
const dashboardSvc = await import("../lib/services/dashboard");
const { db } = await import("../lib/db");
const { streaks } = await import("../lib/db/schema");
const { eq } = await import("drizzle-orm");

const userId = currentUserId();
const today = () => todayInTz(DEFAULT_TIMEZONE);

const server = new McpServer(
  { name: "ikkoma", version: "0.1.0" },
  {
    instructions: `Ikkoma は「目標と今日の30分の間を埋める」学習コーチの永続ストアです。
あなたが学習コーチとして振る舞い、このサーバーは状態の保存と検証だけを行います。

## 毎日の流れ

1. today() で今日の状況を見る。メニューが無ければ 2 へ、あれば 4 へ。
2. menu_context() で材料（各トピックの現在地・次の一手・定番メニュー・期限が来た弱点）を取る。
3. save_menu() で今日の30分メニューを保存する。
   - 「勉強する」のような曖昧な項目は保存時に弾かれる。
   - instruction には必ず「何を・どうやって・どこまで」を書く。完了条件は「10問」「2文」
     「1段落で説明する」のように数えられる形にする。
   - 合計時間は goalMinutes ±5分。期限が来た弱点は冒頭の復習ブロックで消化し、
     その項目の reviewTypeIds に対象の弱点 id を入れる。
   - 制約違反ならエラーで違反箇所が返るので、直して再送すること。
4. start_session() でセッションを開始する。
5. 出題するとき: drill_context() → 自分で問題を作る → save_drill() → ユーザーの答えを
   answer_drill() に渡す。drill_context が返す targetWeaknesses は重み付き抽選済みなので、
   その弱点を突く問題にし、save_drill の targetTypeIds にその id を入れること。
   これが間隔反復の消化判定になる。
6. 自由記述を添削するとき: correction_context() → 添削する → save_correction()。
   **correction_context が返す knownTypes への名寄せを最優先すること。**
   少しでも同じ性質のミスなら新規を作らず既知の型に寄せる（knownTypeId を入れる）。
   名寄せの失敗が弱点リストを壊す一番の原因。本当に新しい型のときだけ knownTypeId を null に。
7. 終わったら completion_context() → 要約と弱点抽出をする → complete_session()。
   ログ・ストリーク・現在地・弱点の下書きがここで確定する。ユーザーに記録を書かせないこと。
8. 抽出された型は未承認の下書き。ユーザーに見せて approve_weakness / reject_weakness を呼ぶ。
   承認して初めて復習キューに入る。

## 原則

- 1日の必須ノルマは30分。それ以上は任意。ハードルを上げない。
- 中断は失敗ではなく正常な運用。pause_topic の理由は後で再開判断に使う。
- active なトピックは2つまで。3つ目は週次配分が破綻しやすい。
- 日付は必ず today() が返すものを使う。`,
  },
);

/* ---------- helpers ---------- */

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
function guard<T extends unknown[]>(fn: (...a: T) => Promise<ReturnType<typeof ok>>) {
  return async (...a: T) => {
    try { return await fn(...a); }
    catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  };
}

const drillShape = {
  question: z.string(),
  choices: z.array(z.object({ key: z.string(), text: z.string() })).optional(),
  correctAnswer: z.string(),
  explanation: z.string(),
  targetTypeIds: z.array(z.string()).default([]),
};

const detectedTypeShape = z.object({
  knownTypeId: z.string().nullable().describe("既知の型に該当するならその id。新規なら null"),
  label: z.string(),
  description: z.string(),
  exampleWrong: z.string(),
  exampleRight: z.string(),
});

/* ---------- 今日 ---------- */

server.registerTool("today", {
  title: "今日の状況",
  description: "今日のメニュー・ストリーク・active なトピック・期限が来た弱点の件数を返す。まずこれを呼ぶ。",
}, guard(async () => {
  const d = today();
  const [menu, [streak], due, topics] = await Promise.all([
    menuSvc.getMenu(userId, d),
    db.select().from(streaks).where(eq(streaks.userId, userId)),
    weaknessSvc.dueWeaknesses(userId, d),
    topicSvc.activeTopics(userId),
  ]);
  return ok({
    today: d,
    hasMenu: menu !== null,
    menu: menu?.items.map((i) => ({
      id: i.item.id, minutes: i.item.minutes, blockKind: i.item.blockKind,
      topic: i.topic.title, title: i.item.title, instruction: i.item.instruction,
      status: i.item.status, reviewTypeIds: i.item.reviewTypeIds,
    })) ?? [],
    streak: streak ?? null,
    dueWeaknesses: due.map((w) => ({ id: w.type.id, label: w.type.label, occurrenceCount: w.type.occurrenceCount })),
    activeTopics: topics.map((t) => ({ id: t.id, title: t.title, goal: t.goal, progress: t.progress })),
  });
}));

/* ---------- メニュー ---------- */

server.registerTool("menu_context", {
  title: "メニュー生成の材料",
  description: "各トピックの現在地・次の一手・定番メニュー・週次リズムの役割・期限が来た弱点・直近ログを返す。",
}, guard(async () => {
  const ctx = await menuSvc.buildMenuContext(userId, today());
  return ok(ctx ?? { error: "active なトピックがありません。create_topic で追加してください。" });
}));

server.registerTool("save_menu", {
  title: "今日のメニューを保存",
  description:
    "今日の30分メニューを保存する。曖昧なタイトル・完了条件のない instruction・合計時間の逸脱は" +
    "保存時に弾かれ、違反箇所が返る。その場合は直して再送すること。",
  inputSchema: {
    items: z.array(z.object({
      topicId: z.string(),
      blockKind: z.enum(["drill", "writing_check", "oral_quiz", "reading", "review"]),
      minutes: z.number().int().positive(),
      title: z.string().describe("一覧に出す短い見出し。「勉強する」等の曖昧語は不可"),
      instruction: z.string().describe("何を・どうやって・どこまで。完了条件を数えられる形で含める"),
      reviewTypeIds: z.array(z.string()).default([]).describe("この項目で消化する弱点型の id"),
    })).min(1),
  },
}, guard(async ({ items }) => {
  const saved = await menuSvc.saveMenu(userId, today(), items, { source: "user_request" });
  return ok({ saved: true, totalMinutes: saved.menu.totalMinutes, items: saved.items.map((i) => ({ id: i.item.id, title: i.item.title })) });
}));

server.registerTool("shrink_menu", {
  title: "今日は5分だけにする",
  description: "最初の項目だけ5分に短縮し、残りをスキップする。ストリークは維持される。",
}, guard(async () => ok(await menuSvc.shrinkToFiveMinutes(userId, today()))));

/* ---------- セッション ---------- */

server.registerTool("start_session", {
  title: "セッション開始",
  description: "メニュー項目の学習を開始する。中断していたセッションがあれば再開される。",
  inputSchema: { menuItemId: z.string() },
}, guard(async ({ menuItemId }) => ok(await sessionSvc.startSession(userId, menuItemId))));

server.registerTool("drill_context", {
  title: "出題の材料",
  description:
    "出題に必要な文脈を返す。targetWeaknesses は再発回数と期限超過で重み付き抽選済み。" +
    "その弱点を突く問題を作り、save_drill の targetTypeIds にその id を入れること。",
  inputSchema: { sessionId: z.string() },
}, guard(async ({ sessionId }) => ok(await sessionSvc.buildDrillContext(sessionId, userId, today()))));

server.registerTool("save_drill", {
  title: "出題を保存",
  description: "作った問題を保存する。返る id を answer_drill に渡す。",
  inputSchema: { sessionId: z.string(), ...drillShape },
}, guard(async ({ sessionId, ...drill }) => {
  const a = await sessionSvc.saveDrill(sessionId, drill);
  return ok({ attemptId: a.id });
}));

server.registerTool("answer_drill", {
  title: "解答を採点",
  description: "解答を採点し、狙っていた弱点の間隔反復に反映する。卒業した型があれば graduated に返る。",
  inputSchema: { attemptId: z.string(), answer: z.string() },
}, guard(async ({ attemptId, answer }) => {
  const r = await sessionSvc.answerDrill(attemptId, answer, today());
  return ok({
    isCorrect: r.attempt.isCorrect, correctAnswer: r.attempt.correctAnswer,
    explanation: r.attempt.explanation, graduated: r.graduated,
  });
}));

server.registerTool("correction_context", {
  title: "添削の材料",
  description:
    "添削に必要な文脈を返す。knownTypes は既知の弱点型。" +
    "**同じ性質のミスは必ずここに名寄せすること。** 名寄せの失敗が弱点リストを壊す。",
  inputSchema: { sessionId: z.string(), userText: z.string() },
}, guard(async ({ sessionId, userText }) =>
  ok(await sessionSvc.buildCorrectionContext(sessionId, userId, userText))));

server.registerTool("save_correction", {
  title: "添削結果を保存",
  description: "添削結果を保存する。detectedTypes はここでは記録のみで、確定は complete_session で行う。",
  inputSchema: {
    sessionId: z.string(),
    userText: z.string(),
    correctedText: z.string(),
    diff: z.array(z.object({ wrong: z.string(), right: z.string(), note: z.string() })).default([]),
    feedback: z.string().describe("励ましではなく、次に同じミスを避けるための判断基準を1〜3文で"),
    detectedTypes: z.array(detectedTypeShape).default([]),
  },
}, guard(async ({ sessionId, userText, ...result }) =>
  ok(await sessionSvc.saveCorrection(sessionId, userText, result))));

server.registerTool("completion_context", {
  title: "セッション完了の材料",
  description: "そのセッションの全ドリル・全添削と既知の弱点型を返す。これを見て要約と弱点抽出を行う。",
  inputSchema: { sessionId: z.string() },
}, guard(async ({ sessionId }) => ok(await sessionSvc.buildCompletionContext(sessionId, userId))));

server.registerTool("complete_session", {
  title: "セッションを完了",
  description:
    "ログ・ストリーク・現在地・弱点の下書きをまとめて確定する。" +
    "抽出された型は未承認なので、返る pendingTypes をユーザーに見せて承認/却下を取ること。",
  inputSchema: {
    sessionId: z.string(),
    summary: z.string().describe("学習ログ1行。やったことと結果が数値で分かる形で40字以内"),
    updatedCurrentState: z.string().nullable().describe("現在地の認識が変わった場合のみ。変わっていなければ null"),
    nextAction: z.string().describe("次回30分でやる一手。対象と完了条件が分かる形で1文"),
    detectedTypes: z.array(detectedTypeShape).default([]),
  },
}, guard(async ({ sessionId, ...result }) => {
  const r = await sessionSvc.applyCompletion(sessionId, userId, today(), result);
  return ok({
    summary: r.session.summary, durationMinutes: r.session.durationMinutes,
    score: r.score, streak: r.streak, nextAction: r.nextAction,
    pendingTypes: r.pendingTypes.map((t) => ({
      id: t.id, label: t.label, description: t.description,
      exampleWrong: t.exampleWrong, exampleRight: t.exampleRight, occurrenceCount: t.occurrenceCount,
    })),
    graduated: r.graduated.map((g) => g.label),
  });
}));

/* ---------- 弱点 ---------- */

server.registerTool("list_weaknesses", {
  title: "弱点リスト",
  description: "弱点の型を発生回数順に返す。次回復習日と間隔レベルつき。",
  inputSchema: { topicId: z.string().optional() },
}, guard(async ({ topicId }) => {
  const rows = await weaknessSvc.listWeaknesses(userId, topicId ? { topicId } : {});
  return ok(rows.map((w) => ({
    id: w.type.id, label: w.type.label, description: w.type.description,
    occurrenceCount: w.type.occurrenceCount, status: w.type.status, approved: w.type.approved,
    topic: w.topicTitle, dueOn: w.review?.dueOn ?? null, intervalStep: w.review?.intervalStep ?? null,
    exampleWrong: w.type.exampleWrong, exampleRight: w.type.exampleRight,
  })));
}));

server.registerTool("approve_weakness", {
  title: "弱点を承認",
  description: "抽出された型を承認して復習キューに入れる。翌日から出題対象になる。",
  inputSchema: { typeId: z.string() },
}, guard(async ({ typeId }) => {
  await weaknessSvc.approveWeakness(typeId, today());
  return ok({ approved: true });
}));

server.registerTool("reject_weakness", {
  title: "弱点を却下",
  description: "抽出された型を却下する。過剰抽出で弱点リストが汚れるのを防ぐ。",
  inputSchema: { typeId: z.string() },
}, guard(async ({ typeId }) => {
  await weaknessSvc.rejectWeakness(typeId);
  return ok({ rejected: true });
}));

/* ---------- トピック ---------- */

server.registerTool("list_topics", {
  title: "トピック一覧",
  description: "全トピックを active → paused → done の順で返す。",
}, guard(async () => ok(await topicSvc.listTopics(userId))));

server.registerTool("topic_detail", {
  title: "トピック詳細",
  description: "目標・現在地・マイルストーン・定番メニューを返す。",
  inputSchema: { topicId: z.string() },
}, guard(async ({ topicId }) => ok(await topicSvc.topicDetail(topicId))));

server.registerTool("create_topic", {
  title: "トピックを追加",
  description:
    "目標とマイルストーンを保存する。M1 は必ず「現在地の実測」にすること。" +
    "menuTemplate には必ず1つ自由記述で書かせるブロックを入れる（ミスの型はそこからしか取れない）。",
  inputSchema: {
    topicTitle: z.string().describe("短い名詞。例: TOEIC、AWS AgentCore"),
    goal: z.string(),
    currentState: z.string().optional(),
    firstNextAction: z.string().optional(),
    milestones: z.array(z.object({
      code: z.string(), title: z.string(), detail: z.string().optional(),
    })).optional(),
    menuTemplate: z.array(z.object({
      blockKind: z.enum(["drill", "writing_check", "oral_quiz", "reading", "review"]),
      minutes: z.number().int().positive(), instruction: z.string(),
    })).optional(),
  },
}, guard(async (draft) => ok(await topicSvc.createTopic(userId, draft))));

server.registerTool("pause_topic", {
  title: "トピックを中断",
  description: "中断は失敗ではなく正常な運用。理由は後で再開判断に使うので必ず残す。",
  inputSchema: { topicId: z.string(), reason: z.string() },
}, guard(async ({ topicId, reason }) => ok(await topicSvc.pauseTopic(topicId, reason))));

server.registerTool("resume_topic", {
  title: "トピックを再開",
  description: "空白期間が返る。needsRecheck が true なら現在地の再確認から始めること。",
  inputSchema: { topicId: z.string() },
}, guard(async ({ topicId }) => ok(await topicSvc.resumeTopic(topicId))));

server.registerTool("toggle_milestone", {
  title: "マイルストーンの完了を切り替え",
  description: "完了状態を切り替えると進捗%が再計算される。",
  inputSchema: { milestoneId: z.string(), done: z.boolean() },
}, guard(async ({ milestoneId, done }) => ok(await topicSvc.toggleMilestone(milestoneId, done))));

server.registerTool("dashboard", {
  title: "学習の記録",
  description: "ストリーク・ヒートマップ・トピック別時間・弱点の増減を返す。週次の振り返りに使う。",
}, guard(async () => {
  const d = await dashboardSvc.dashboard(userId, today());
  return ok({
    streak: d.streak, totalMinutes: d.totalMinutes,
    activeWeaknesses: d.activeWeaknesses, graduatedWeaknesses: d.graduatedWeaknesses,
    perTopic: d.perTopic,
    recentSessions: d.recentSessions.map((r) => ({
      date: r.session.startedAt.toISOString().slice(0, 10),
      topic: r.topic.title, minutes: r.session.durationMinutes, summary: r.session.summary,
    })),
    studiedDaysLast18Weeks: d.heatmap.filter((h) => h.minutes > 0).length,
  });
}));

await server.connect(new StdioServerTransport());
console.error("[ikkoma-mcp] ready");
