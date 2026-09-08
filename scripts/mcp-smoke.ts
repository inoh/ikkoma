/**
 * MCP サーバーの疎通確認。サーバーを子プロセスで起動し、
 * tools/list とコアループのツールを実際に叩く。
 *
 *   npx tsx scripts/mcp-smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "mcp/server.ts"],
  env: { ...process.env } as Record<string, string>,
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0]?.text ?? "";
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* エラー応答は JSON ではない */ }
  return { isError: r.isError === true, text, json };
};

/** 失敗したらそこで止めて中身を見せる */
const must = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await call(name, args);
  if (r.isError || r.json === null) {
    console.error(`✗ ${name} が失敗:\n${r.text}`);
    process.exit(1);
  }
  return r;
};

const { tools } = await client.listTools();
console.log(`✓ tools/list: ${tools.length}件`);
console.log(`  ${tools.map((t) => t.name).join(", ")}`);

const t = await must("today");
console.log(`✓ today: ${t.json.today} / hasMenu=${t.json.hasMenu} / activeTopics=${t.json.activeTopics.length} / streak=${t.json.streak?.currentStreak}`);

// トピックが無ければ作る（オンボーディング相当）
if (t.json.activeTopics.length === 0) {
  const created = await must("create_topic", {
    topicTitle: "TOEIC",
    goal: "TOEIC 600点取得",
    currentState: "推定300〜400点。基礎文法を全範囲固める方針",
    firstNextAction: "品詞ドリル10問",
    milestones: [
      { code: "M1", title: "レベルチェック", detail: "文法15問+語彙5問で実力を推定する" },
      { code: "M2", title: "基礎固め（文法・頻出単語）", detail: "品詞→前置詞→接続詞→時制の順" },
    ],
    menuTemplate: [
      { blockKind: "drill", minutes: 20, instruction: "その日のテーマの問題を10問出題・解説する" },
      { blockKind: "writing_check", minutes: 10, instruction: "学んだ文法で英文を2文つくらせ添削する" },
    ],
  });
  console.log(`✓ create_topic: ${created.json.topic.title} (warning=${created.json.warning ?? "なし"})`);
}

const ctx = await must("menu_context");
console.log(`✓ menu_context: goal=${ctx.json.goalMinutes}分 topics=${ctx.json.topics.map((x: {title:string}) => x.title).join("/")} due=${ctx.json.dueWeaknesses.length}件`);

// 制約違反を弾くか（曖昧なタイトル + 完了条件なし）
const bad = await call("save_menu", {
  items: [{ topicId: ctx.json.topics[0].id, blockKind: "drill", minutes: 30, title: "勉強する", instruction: "がんばる" }],
});
console.log(`${bad.isError ? "✓" : "✗"} save_menu(不正) は拒否された`);
console.log(`  ${bad.text.split("\n").slice(0, 4).join("\n  ")}`);

// 正しいメニューは通るか
const topicId = ctx.json.topics[0].id;
const good = await call("save_menu", {
  items: [
    { topicId, blockKind: "review", minutes: 5, title: "昨日の弱点を再テスト",
      instruction: "冠詞の付け忘れと副詞の語順について各2問ずつ計4問を出題して答える", reviewTypeIds: [] },
    { topicId, blockKind: "drill", minutes: 15, title: "品詞ドリル",
      instruction: "品詞の見分けを問う4択問題を10問出題し、1問ずつ解説する", reviewTypeIds: [] },
    { topicId, blockKind: "writing_check", minutes: 10, title: "英作文チェック",
      instruction: "今日の文法を使って英文を2文つくらせ、添削してミスの型を洗い出す", reviewTypeIds: [] },
  ],
});
console.log(`${good.isError ? "✗" : "✓"} save_menu(正常): 合計${good.json?.totalMinutes}分 ${good.json?.items.length}項目`);

// セッション → 出題 → 採点
const menuItemId = good.json.items[0].id;
const sess = await must("start_session", { menuItemId });
console.log(`✓ start_session: ${sess.json.id.slice(0, 8)} state=${sess.json.state}`);

const dctx = await must("drill_context", { sessionId: sess.json.id });
console.log(`✓ drill_context: 狙う弱点=${dctx.json.targetWeaknesses.map((w: {label:string}) => w.label).join("/") || "なし"}`);

const targetId = dctx.json.targetWeaknesses[0]?.id;
const drill = await must("save_drill", {
  sessionId: sess.json.id,
  question: "The report was reviewed ___ before submission.",
  choices: [{ key: "A", text: "careful" }, { key: "B", text: "carefully" }],
  correctAnswer: "B", explanation: "動詞を修飾するので副詞",
  targetTypeIds: targetId ? [targetId] : [],
});
const ans = await must("answer_drill", { attemptId: drill.json.attemptId, answer: "B" });
console.log(`✓ answer_drill: isCorrect=${ans.json.isCorrect} graduated=${ans.json.graduated.length}件`);

// 完了 → 弱点の下書き
const cctx = await must("completion_context", { sessionId: sess.json.id });
console.log(`✓ completion_context: attempts=${cctx.json.attempts.length} knownTypes=${cctx.json.knownTypes.length}件`);

const done = await must("complete_session", {
  sessionId: sess.json.id,
  summary: "品詞ドリル1問(1/1)",
  updatedCurrentState: null,
  nextAction: "前置詞ドリル10問",
  detectedTypes: [{
    knownTypeId: null, label: "スモークテスト用の型", description: "確認用",
    exampleWrong: "× wrong", exampleRight: "○ right",
  }],
});
console.log(`✓ complete_session: streak=${done.json.streak.currentStreak}日 pending=${done.json.pendingTypes.length}件`);

const pendingId = done.json.pendingTypes[0].id;
await call("approve_weakness", { typeId: pendingId });
const list = await must("list_weaknesses");
const approved = list.json.find((w: { id: string }) => w.id === pendingId);
console.log(`✓ approve_weakness: approved=${approved.approved} dueOn=${approved.dueOn}`);

await call("reject_weakness", { typeId: pendingId });
console.log("✓ reject_weakness");

await client.close();
console.log("\nMCP サーバーの疎通確認 OK");
process.exit(0);
