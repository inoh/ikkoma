# 06. アーキテクチャ

## 全体構成（MVP）

```
┌──────────────┐
│  Next.js     │  App Router / React Server Components
│  (Vercel)    │  ─ UI (S1–S9)
│              │  ─ Route Handlers = API
└──────┬───────┘
       │
       ├──→ ┌────────────────┐
       │    │  Postgres      │  Supabase or Neon
       │    │  + RLS         │  行レベルで user_id 分離
       │    └────────────────┘
       │
       ├──→ ┌────────────────┐
       │    │  Claude API    │  メニュー生成 / 出題 / 添削 / 弱点抽出
       │    └────────────────┘
       │
       └──→ ┌────────────────┐
            │  Cron          │  Vercel Cron: 昼12:00 / 夜21:00 通知
            └────────────────┘
                   ↓
            Web Push (MVP) → LINE / Slack (Phase 2)
```

技術選定の理由：
- **Next.js**：画面が主役でありサーバー処理は軽い。1リポジトリで完結させたい
- **Postgres + RLS**：Phase 2 の複数人化を見据える。RLS を最初から効かせておけば
  「他人のデータが見えた」事故を構造的に防げる
- **Claude API**：ストリーミング応答が学習セッションの体験に直結する

## 2つの実行モード

AI をサーバーに置くかどうかで2通りの動かし方がある。service 層を
**「材料を集める関数」と「結果を検証して保存する関数」**に割り、その間に誰が入るかだけを変える。

```
  buildMenuContext()  ──►  [ 思考する主体 ]  ──►  saveMenu()
  buildDrillContext()                            saveDrill()
  buildCorrectionContext()                       saveCorrection()
  buildCompletionContext()                       applyCompletion()
                              │
        API モード ───────────┤  Claude API（lib/ai/*）
        MCP モード ───────────┘  接続元のモデル（Claude Code など）
```

| | API モード | MCP モード |
|---|---|---|
| AI の実行場所 | Vercel Functions | 接続元のクライアント |
| `ANTHROPIC_API_KEY` | 必要 | **不要** |
| デプロイ | Vercel | ローカルのみ |
| 通知 | Vercel Cron | クライアント側のスケジューラ |
| セッション UI | S2（Web） | クライアントの対話 |
| 複数人対応 | 可能 | 不可（各自がクライアントを持つ必要がある） |

**検証は保存関数側にあるので、どちらのモードでも品質保証は同じ。**
これが設計上の要点。MCP 経由でモデルが曖昧なメニューを渡してきた場合も `saveMenu` が
`MenuValidationError` で違反箇所を返し、モデルが直して再送する。
API 側の「生成 → 検証 → 1回リトライ」と同じループが、駆動する側を変えて成立する。

MCP サーバー（`mcp/server.ts`）は22ツールを公開する。ツールの description と
サーバーの instructions が、API モードのシステムプロンプトに相当する役割を果たす。
とくに `correction_context` は既知の弱点型を返し、
「同じ性質のミスは必ず名寄せすること」を description で強制している。

## AI パートの設計（API モード）

AI の呼び出しは4種類。**それぞれ独立したプロンプトとスキーマを持つ**（1つの巨大プロンプトにしない）。

### AI-1. メニュー生成 `POST /api/menu/generate`

| | |
|---|---|
| 入力 | 曜日・週次リズム / active topics の goal・current_state・next_actions・定番メニュー / `due_on <= today` の弱点型 / 直近7日のログ |
| 出力 | `menu_items[]`（structured output） |
| 検証 | **各 instruction が「対象・方法・完了条件」を含むかを検証し、欠けていれば再生成**。合計時間が目標±5分に収まるか |

これが最も品質を左右する。テストケース（現在地パターン × 曜日 × キュー状態）を
リグレッションスイートとして持つ。

### AI-2. 出題 `POST /api/session/:id/next-question`

| | |
|---|---|
| 入力 | menu_item の instruction / トピックの現在マイルストーン / **狙う弱点型**（重み付き抽選済み） |
| 出力 | `question`, `choices?`, `correct_answer`, `explanation`, `target_type_ids` |
| 注意 | 直近に出した問題を渡して重複を避ける |

### AI-3. 添削 `POST /api/session/:id/correct`

| | |
|---|---|
| 入力 | ユーザーの自由記述 / トピック文脈 / **既知の弱点型リスト**（再発判定のため） |
| 出力 | `corrected_text`, `diff[]`, `feedback`, `detected_types[]`（既存型 id または新規型の下書き） |

**既知の型リストを渡すのが肝**。渡さないと同じミスに毎回違うラベルが付き、
弱点リストが名寄せできずに壊れる。

### AI-4. セッション要約 & 弱点確定 `POST /api/session/:id/complete`

| | |
|---|---|
| 入力 | セッション中の attempts と corrections 全体 |
| 出力 | `summary`（ログ1行）/ `new_types[]` / `recurrences[]` / `next_action` |
| 後処理 | ユーザー承認 → weakness_types / weakness_events / review_state を更新（S3） |

## 間隔反復エンジン

AI ではなく**決定的なロジック**で実装する（再現性が必要なため）。

```ts
const INTERVALS = [1, 3, 7, 16, 35] // days

function onReview(state: ReviewState, correct: boolean): ReviewState {
  if (correct) {
    const step = Math.min(state.interval_step + 1, INTERVALS.length - 1)
    return {
      interval_step: step,
      due_on: addDays(today, INTERVALS[step]),
      consecutive_correct: state.consecutive_correct + 1,
      last_reviewed_at: now(),
    }
  }
  return {
    interval_step: 0,
    due_on: addDays(today, 1),
    consecutive_correct: 0,
    last_reviewed_at: now(),
  }
}

// 出題の重み付け抽選
weight(type) = occurrence_count * 2 + daysOverdue(type) + 1
```

## 主要 API

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/today` | S1 のデータ一括取得（メニュー・ストリーク・進捗） |
| POST | `/api/menu/generate` | メニュー生成／組み直し |
| POST | `/api/sessions` | セッション開始 |
| POST | `/api/sessions/:id/messages` | 対話（SSE ストリーム） |
| POST | `/api/sessions/:id/answer` | ドリル解答 |
| POST | `/api/sessions/:id/complete` | 完了・要約・弱点抽出 |
| POST | `/api/weaknesses/:id/approve` \| `/reject` | 弱点型の承認 |
| GET/POST | `/api/topics`, `/api/topics/:id` | トピック CRUD・状態遷移 |
| GET | `/api/dashboard` | ヒートマップ・集計 |
| POST | `/api/cron/notify` | Vercel Cron から昼／夜通知 |

## コスト設計

1セッション（30分）あたりの Claude 呼び出しは概算：
メニュー生成1回 + 出題10回 + 添削2〜3回 + 要約1回 ≒ 15回。
- 出題・添削は**軽量モデル**、メニュー生成と要約・弱点抽出は**上位モデル**で分ける
- メニューは1日1回キャッシュし、「組み直す」時のみ再生成する

## Phase 2 で見直す点

- **認証**：MVP は単一ユーザー（自分）で認証を省略可。Phase 2 で Auth を入れる。
  ただし RLS とスキーマの `user_id` は MVP から入れておく
- **AI 実行基盤**：セッションが長時間・ステートフルになるため、
  Amazon Bedrock AgentCore の Runtime / Memory への載せ替えを検討する
  （Runtime＝セッション分離、Memory＝現在地と弱点の長期記憶、Observability＝品質計測）。
  ちょうど学習中のテーマがそのまま設計判断になる
- **通知**：Web Push → LINE Messaging API / Slack App

## リスク

| リスク | 影響 | 対策 |
|---|---|---|
| メニューが曖昧・的外れ | サービス価値が消える | 生成後バリデータ + リグレッションスイート。ユーザーの「組み直す」を必ず用意 |
| 弱点型の名寄せ失敗 | 弱点リストが肥大化して無価値に | 既知型リストを添削入力に必ず渡す。ユーザー承認を挟む。定期的な型のマージ機能 |
| AI コスト超過 | 継続不能 | モデルの使い分け・メニューのキャッシュ・1日あたり呼び出し上限 |
| 継続率 | 全て | 「今日は5分だけ」の逃げ道。中断を失敗扱いしない |
