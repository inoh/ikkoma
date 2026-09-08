import Anthropic from "@anthropic-ai/sdk";

/**
 * モデルは2段に分ける。
 * 出題・添削は1セッションで10回以上走るので軽量モデル、
 * メニュー生成と弱点抽出は品質がサービス価値に直結するので上位モデルを使う。
 * docs/06-architecture.md「コスト設計」に対応。
 */
export const MODELS = {
  /** 高頻度・低単価: 出題、添削 */
  fast: "claude-haiku-4-5",
  /** 低頻度・高品質: メニュー生成、セッション要約と弱点抽出 */
  smart: "claude-sonnet-5",
} as const;

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY が未設定です");
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * tool_use を使って構造化出力を強制する。
 * 「JSON で返して」とプロンプトで頼むより破綻しにくい。
 */
export async function structured<T>(opts: {
  model: string;
  system: string;
  prompt: string;
  schemaName: string;
  schemaDescription: string;
  inputSchema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const res = await anthropic().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    tools: [{
      name: opts.schemaName,
      description: opts.schemaDescription,
      input_schema: opts.inputSchema as never,
    }],
    tool_choice: { type: "tool", name: opts.schemaName },
  });

  const block = res.content.find((c) => c.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error(`構造化出力が返りませんでした (stop_reason=${res.stop_reason})`);
  }
  return block.input as T;
}
