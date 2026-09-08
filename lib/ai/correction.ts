import { MODELS, structured } from "./client";

export type CorrectionRequest = {
  topicTitle: string;
  instruction: string;
  userText: string;
  /**
   * 既知の弱点型。これを渡さないと同じミスに毎回違うラベルが付き、
   * 弱点リストが名寄せできずに壊れる。docs/06-architecture.md の AI-3 参照。
   */
  knownTypes: { id: string; label: string; description: string }[];
};

export type CorrectionResult = {
  correctedText: string;
  diff: { wrong: string; right: string; note: string }[];
  feedback: string;
  detectedTypes: {
    /** 既知の型に該当するならその id。新しい型なら null */
    knownTypeId: string | null;
    label: string;
    description: string;
    exampleWrong: string;
    exampleRight: string;
  }[];
};

const SYSTEM = `あなたは学習コーチとして、ユーザーが書いた文を添削します。

最重要: ミスを「型」として抽象化すること。
- 「Q7を間違えた」ではなく「冠詞の付け忘れ」のように、他の文にも転用できる粒度でラベルを付ける。
- knownTypes に該当する型があれば必ずその id を knownTypeId に入れる（再発として扱われる）。
  少しでも同じ性質のミスなら新規を作らず既知の型に寄せること。名寄せの失敗が一番の害。
- 本当に新しい型のときだけ knownTypeId を null にして、label と description を書く。
- 1回の添削で detectedTypes は多くても4件まで。些細な揺れは型にしない。
- feedback は励ましではなく、次に同じミスを避けるための判断基準を1〜3文で。
- label / description / note / feedback はすべて日本語で書く。`;

const INPUT_SCHEMA = {
  type: "object",
  properties: {
    correctedText: { type: "string" },
    diff: {
      type: "array",
      items: {
        type: "object",
        properties: { wrong: { type: "string" }, right: { type: "string" }, note: { type: "string" } },
        required: ["wrong", "right", "note"],
      },
    },
    feedback: { type: "string" },
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
  required: ["correctedText", "diff", "feedback", "detectedTypes"],
};

export function correct(req: CorrectionRequest): Promise<CorrectionResult> {
  return structured<CorrectionResult>({
    model: MODELS.fast,
    system: SYSTEM,
    prompt: JSON.stringify(req, null, 2),
    schemaName: "emit_correction",
    schemaDescription: "添削結果と、そこから抽出したミスの型",
    inputSchema: INPUT_SCHEMA,
    maxTokens: 2048,
  });
}
