import { MODELS, structured } from "./client";

export type DrillRequest = {
  topicTitle: string;
  instruction: string;
  currentMilestone: string | null;
  /** 重み付き抽選で選ばれた、今回狙う弱点 */
  targetWeaknesses: { id: string; label: string; description: string; exampleWrong: string | null }[];
  /** 直近に出した問題文。重複を避けるために渡す */
  recentQuestions: string[];
};

export type Drill = {
  question: string;
  choices?: { key: string; text: string }[];
  correctAnswer: string;
  explanation: string;
  targetTypeIds: string[];
};

const SYSTEM = `あなたは学習コーチとして問題を1問だけ出題します。

- targetWeaknesses が与えられていれば、その弱点を突く問題にすること。
  出題した弱点の id を targetTypeIds に入れる（間隔反復の消化判定に使う）。
- recentQuestions と同じ問題を出さないこと。
- 選択式にする場合は choices を4つ、correctAnswer には正解のキー(A/B/C/D)を入れる。
  記述式にする場合は choices を省略し、correctAnswer に模範解答を入れる。
- explanation は「なぜそうなるか」のルールを1〜2文で。暗記ではなく判断基準を渡す。
- 問題文の言語は学習対象に合わせる（英語学習なら英文、技術学習なら日本語）。
  解説は必ず日本語で書く。`;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    question: { type: "string" },
    choices: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, text: { type: "string" } },
        required: ["key", "text"],
      },
    },
    correctAnswer: { type: "string" },
    explanation: { type: "string" },
    targetTypeIds: { type: "array", items: { type: "string" } },
  },
  required: ["question", "correctAnswer", "explanation", "targetTypeIds"],
};

export function nextDrill(req: DrillRequest): Promise<Drill> {
  return structured<Drill>({
    model: MODELS.fast,
    system: SYSTEM,
    prompt: JSON.stringify(req, null, 2),
    schemaName: "emit_drill",
    schemaDescription: "1問分の出題",
    inputSchema: INPUT_SCHEMA,
    maxTokens: 1024,
  });
}
