import { MODELS, structured } from "./client";
import { validateMenu, type DraftMenuItem, type ValidationIssue } from "@/lib/domain/menu";

export type MenuContext = {
  date: string;
  weekdayLabel: string;
  goalMinutes: number;
  topics: {
    id: string; title: string; goal: string; currentState: string;
    nextActions: string[];
    currentMilestone: string | null;
    menuTemplate: { blockKind: string; minutes: number; instruction: string }[];
    role: "main" | "warmup" | "weekly_review" | null;
  }[];
  dueWeaknesses: { id: string; topicId: string; label: string; occurrenceCount: number; exampleWrong: string | null }[];
  recentLog: { date: string; topic: string; summary: string }[];
};

const SYSTEM = `あなたはユーザーの学習コーチです。今日の学習メニューを組み立てます。

絶対に守る制約:
- 「勉強する」「復習する」のような曖昧な項目を出力してはいけない。
  各項目の instruction には必ず「何を・どうやって・どこまで」を含めること。
  完了条件は「10問」「2文」「1段落で説明する」のように数えられる形にする。
- 合計時間は goalMinutes ±5分に収めること。
- 期限が来た弱点(dueWeaknesses)がある場合、冒頭に review ブロックを置いて必ず消化すること。
  その項目の reviewTypeIds に対象の弱点 id を入れる。
- 週次リズムで role=warmup のトピックは、冒頭5分の短いブロックとして混ぜる。
- 各項目は Ikkoma 内で完結する形にする（AI が出題する / 添削する / 口頭試問する / 壁打ちする）。
- 日本語で書く。`;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topicId: { type: "string" },
          blockKind: { type: "string", enum: ["drill", "writing_check", "oral_quiz", "reading", "review"] },
          minutes: { type: "integer" },
          title: { type: "string", description: "一覧に出す短い見出し（曖昧語は禁止）" },
          instruction: { type: "string", description: "何を・どうやって・どこまで。完了条件を数えられる形で含める" },
          reviewTypeIds: { type: "array", items: { type: "string" } },
        },
        required: ["topicId", "blockKind", "minutes", "title", "instruction"],
      },
    },
  },
  required: ["items"],
};

/** 生成 → バリデート → 失敗なら指摘を添えて1回だけ再生成 */
export async function generateMenu(ctx: MenuContext): Promise<{ items: DraftMenuItem[]; retried: boolean }> {
  const topicIds = ctx.topics.map((t) => t.id);
  const basePrompt = JSON.stringify(ctx, null, 2);

  let issues: ValidationIssue[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0
      ? `以下の状況から今日のメニューを組んでください。\n\n${basePrompt}`
      : `直前の出力は以下の点で制約に違反していました。修正して出し直してください。\n\n違反:\n${
          issues.map((i) => `- items[${i.index}].${i.field}: ${i.message}`).join("\n")
        }\n\n状況:\n${basePrompt}`;

    const out = await structured<{ items: DraftMenuItem[] }>({
      model: MODELS.smart,
      system: SYSTEM,
      prompt,
      schemaName: "emit_menu",
      schemaDescription: "今日の学習メニュー",
      inputSchema: INPUT_SCHEMA,
      maxTokens: 2048,
    });

    issues = validateMenu(out.items, ctx.goalMinutes, topicIds);
    if (issues.length === 0) return { items: out.items, retried: attempt > 0 };
  }

  throw new Error(
    `メニュー生成がバリデーションを2回とも通りませんでした:\n${
      issues.map((i) => `items[${i.index}].${i.field}: ${i.message}`).join("\n")
    }`,
  );
}
