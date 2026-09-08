import { MODELS, structured } from "./client";

export type CompleteRequest = {
  topicTitle: string;
  currentState: string;
  currentMilestone: string | null;
  durationMinutes: number;
  attempts: { question: string; userAnswer: string | null; correctAnswer: string; isCorrect: boolean | null }[];
  corrections: { userText: string; correctedText: string; feedback: string }[];
  knownTypes: { id: string; label: string; description: string }[];
};

export type CompleteResult = {
  /** 学習ログ1行になる要約 */
  summary: string;
  /** 更新後の現在地メモ。変更が要らなければ null */
  updatedCurrentState: string | null;
  nextAction: string;
  detectedTypes: {
    knownTypeId: string | null;
    label: string;
    description: string;
    exampleWrong: string;
    exampleRight: string;
  }[];
};

const SYSTEM = `セッション全体を振り返り、学習ログと弱点の確定を行います。

- summary は学習ログの1行になる。「品詞ドリル10問(8/10)+英作文2文添削」のように
  やったことと結果が数値で分かる形で、40字以内。
- updatedCurrentState は、このセッションで現在地の認識が変わった場合のみ書く。
  変わっていなければ null。安易に書き換えない。
- nextAction は次回30分でやる一手を、対象と完了条件が分かる形で1文。
- detectedTypes は knownTypes への名寄せを最優先する。同じ性質のミスは必ず既知 id に寄せる。
  ドリルの誤答と添削の両方から拾うが、多くても4件まで。
- すべて日本語で書く。`;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    updatedCurrentState: { type: ["string", "null"] },
    nextAction: { type: "string" },
    detectedTypes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          knownTypeId: { type: ["string", "null"] },
          label: { type: "string" },
          description: { type: "string" },
          exampleWrong: { type: "string" },
          exampleRight: { type: "string" },
        },
        required: ["knownTypeId", "label", "description", "exampleWrong", "exampleRight"],
      },
    },
  },
  required: ["summary", "updatedCurrentState", "nextAction", "detectedTypes"],
};

export function completeSession(req: CompleteRequest): Promise<CompleteResult> {
  return structured<CompleteResult>({
    model: MODELS.smart,
    system: SYSTEM,
    prompt: JSON.stringify(req, null, 2),
    schemaName: "emit_session_result",
    schemaDescription: "セッション要約・現在地更新・弱点抽出",
    inputSchema: INPUT_SCHEMA,
    maxTokens: 2048,
  });
}
