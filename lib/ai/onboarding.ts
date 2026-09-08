import { MODELS, structured } from "./client";

export type MilestoneProposal = {
  topicTitle: string;
  milestones: { code: string; title: string; detail: string }[];
  menuTemplate: { blockKind: string; minutes: number; instruction: string }[];
  currentState: string;
  firstNextAction: string;
};

const SYSTEM = `ユーザーの目標を受け取り、そこに至るマイルストーンを設計します。

- マイルストーンは4〜6個。M1 から順に、前のものが次の前提になるように並べる。
- M1 は必ず「現在地の実測」にする（レベルチェック、既存知識の棚卸しなど）。
  現在地が分からないままでは以降のメニュー精度が出ないため。
- 最後のマイルストーンは目標の達成そのものにする。
- menuTemplate は「毎回の30分の組み立て」。合計30分。
  語学なら「ドリル + 自由記述の添削」、技術なら「読解 + 自分の言葉で説明」のように、
  必ず1つは自由記述で書かせるブロックを入れる（ミスの型はそこからしか取れない）。
- topicTitle は短い名詞（例: TOEIC、AWS AgentCore）。
- すべて日本語で書く。`;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    topicTitle: { type: "string" },
    milestones: {
      type: "array",
      items: {
        type: "object",
        properties: { code: { type: "string" }, title: { type: "string" }, detail: { type: "string" } },
        required: ["code", "title", "detail"],
      },
    },
    menuTemplate: {
      type: "array",
      items: {
        type: "object",
        properties: {
          blockKind: { type: "string", enum: ["drill", "writing_check", "oral_quiz", "reading", "review"] },
          minutes: { type: "integer" },
          instruction: { type: "string" },
        },
        required: ["blockKind", "minutes", "instruction"],
      },
    },
    currentState: { type: "string" },
    firstNextAction: { type: "string" },
  },
  required: ["topicTitle", "milestones", "menuTemplate", "currentState", "firstNextAction"],
};

export function proposeMilestones(input: {
  goal: string; selfReport: string; deadline?: string; dailyMinutes: number;
}): Promise<MilestoneProposal> {
  return structured<MilestoneProposal>({
    model: MODELS.smart,
    system: SYSTEM,
    prompt: JSON.stringify(input, null, 2),
    schemaName: "emit_milestones",
    schemaDescription: "目標に対するマイルストーンと定番メニューの提案",
    inputSchema: INPUT_SCHEMA,
    maxTokens: 2048,
  });
}
