# Ikkoma（一コマ）

**目標と「今日の30分」の間を埋める、AI学習コーチサービス。**

名前は「授業の1コマ」の一コマから。毎日30分＝1コマを積み上げる、という単位そのものを名前にした。

学習アプリはコンテンツをくれるが、「今日の自分が、何を、どこまでやればいいか」は決めてくれない。
Ikkoma は目標からマイルストーンを引き、毎日の30分メニューを組み立て、対話で伴走し、
間違いを「ミスの型」として蓄積して間隔反復に戻す。

このリポジトリは、2026-09 から運用している個人の学習習慣システム
（Markdown + AI コーチ、[inoh/study](https://github.com/inoh/study)）を
サービスとして再設計・実装したもの。実運用で効いた仕組みだけを機能に昇格させている。

## コアループ

```
① 提示  今日の30分メニューを自動生成（週次リズム × 現在地 × 復習キュー）
   ↓
② 実施  AI と対話しながらドリル・添削・口頭試問
   ↓
③ 記録  学習ログ・ストリーク・進捗を自動更新（ユーザーには書かせない）
   ↓
④ 抽出  誤答と添削差分から「ミスの型」を抽出し、ユーザーが承認
   ↓
⑤ 反復  間隔反復キューへ投入 → 翌日メニューの冒頭5分に戻る ──→ ①
```

④→⑤→① の還流が閉じていることが Ikkoma の全て。続けるほどメニューが自分専用になる。

## 動かす

前提: Node 20+ / PostgreSQL

```bash
npm install
cp .env.example .env          # DATABASE_URL と ANTHROPIC_API_KEY を設定
createdb ikkoma
npm run db:push               # スキーマ適用
npm run db:seed               # study リポジトリの Markdown を取り込む
# → 出力された user id を .env の IKKOMA_USER_ID に設定
npm run dev                   # http://localhost:3100
```

ポートは既定 3100。他と被るときはシェル環境変数で上書きする（`.env` ではなくシェル側）。

```bash
PORT=3200 npm run dev
```

`npm run db:seed` は `~/Documents/workspace/study`（`STUDY_REPO_PATH` で変更可）の
`topics/*.md` と `DASHBOARD.md` を読んで、トピック・マイルストーン・弱点リスト・
週次リズム・ストリークを取り込む。既存データは冪等に入れ替わる。

### テスト

```bash
npm run test                  # ドメインロジック（DB不要・38件）
createdb ikkoma_test && TEST_DATABASE_URL=postgres://localhost:5432/ikkoma_test npm run db:push
npm run test:integration      # コアループの統合テスト（AI のみスタブ・10件）
```

```bash
npm run mcp:smoke             # MCP サーバーを子プロセスで起動して22ツールを叩く
```

統合テストは AI 呼び出しだけをスタブし、DB とサービス層は本物を通す。
API キーなしでコアループ全体（生成→出題→採点→添削→完了→承認→間隔反復）を検証できる。
`mcp:smoke` は MCP 経由で同じループを通し、不正なメニューが弾かれることまで確認する。

## 2つの動かし方

Ikkoma は **AI をサーバーに持つ / 持たない** の両方で動く。service 層が「材料を集める関数」と
「結果を検証して保存する関数」に分かれていて、その間に誰が入るかだけが違う。

```
                      buildMenuContext()          saveMenu()  ← 検証はここ
                            │                        ▲
  ┌── API モード ───────────┼── Claude API ──────────┤   ANTHROPIC_API_KEY が要る
  │                         │                        │   Vercel にデプロイできる
  └── MCP モード ───────────┴── Claude Code ─────────┘   API キー不要（サブスクで動く）
                                （接続元のモデル）        ローカル専用
```

**検証は保存関数側にある**ので、どちらの経路でも品質保証は同じ。
MCP 経由でモデルが曖昧なメニューを渡してきた場合も `save_menu` が違反箇所を列挙して差し戻し、
モデルが直して再送する。API 側の「生成→検証→リトライ」と同じループが向きを変えて成立する。

### MCP モード（API キー不要）

Claude Code から接続して使う。学習の思考は Claude Code 側のモデルが行い、
Ikkoma は状態の保存と検証だけを担う。`ANTHROPIC_API_KEY` は不要。

```bash
npm run mcp          # 単体起動（動作確認用）
npm run mcp:smoke    # コアループの疎通確認
```

このリポジトリで `claude` を起動すれば `.mcp.json` が読まれて自動で繋がる。
別のプロジェクト（例: study リポジトリ）から使う場合は、そちらの `.mcp.json` にこう書く。

```json
{
  "mcpServers": {
    "ikkoma": {
      "command": "npx",
      "args": ["tsx", "--tsconfig", "/path/to/ikkoma/tsconfig.json", "/path/to/ikkoma/mcp/server.ts"]
    }
  }
}
```

`.env` はリポジトリ基準で解決するので、どの cwd から起動しても動く。
公開ツールは22個。詳細は `mcp/server.ts` のサーバー instructions を参照。

**MCP モードの制約**

- **通知が成立しない** — MCP サーバーは自分から動けない。Claude Code のスケジュールタスクで代替する
- **Web の対話画面（S2）は使わない** — 学習は Claude Code の中で起きる。Web は閲覧用になる
- **複数人対応には使えない** — 各ユーザーが自分の Claude Code とローカル環境を持つ必要がある。
  Phase 2 では API モードに戻る

### API モード（Vercel にデプロイする場合）

サーバレス前提。アイドル時のコストがゼロになる組み合わせを選んでいる。

| レイヤ | 選択 | 費用 |
|---|---|---|
| アプリ / API | Next.js 15 App Router on **Vercel Functions** | Hobby は無料 |
| DB | **Neon** Postgres（HTTP ドライバ、コネクション不要） | 無料枠 |
| スケジューラ | **Vercel Cron**（昼12:00 / 夜21:00 の2本） | 無料枠（Hobby は1日1回×2枠） |
| AI | **Anthropic API**（2段構成） | 従量。実質ここだけ |

ローカル開発では `DATABASE_URL` の向き先で自動的に postgres.js ドライバに切り替わる
（`lib/db/index.ts`）。Neon のときだけ HTTP ドライバを使う。

### AI のコスト設計

1セッションあたり約15回 Claude を呼ぶ。全部を上位モデルで叩くと続かないので2段に分ける。

| 用途 | モデル | 頻度 |
|---|---|---|
| 出題（AI-2）・添削（AI-3） | Haiku | 1セッション10〜13回 |
| メニュー生成（AI-1）・要約と弱点抽出（AI-4） | Sonnet | 1日1回 + 1セッション1回 |

さらにメニューは日付単位でキャッシュし、「組み直す」を押したときだけ再生成する。

## 実装の要点

**メニュー生成には必ずバリデータを通す**（`lib/domain/menu.ts`）。
「勉強する」のような曖昧な項目、完了条件が読み取れない instruction、
合計時間が目標±5分から外れたものを機械的に弾き、違反内容を添えて1回だけ再生成させる。
2回失敗したらエラーにする。ここが緩むとサービス価値が消える。

**添削には既知の弱点型リストを必ず渡す**（`lib/ai/correction.ts`）。
渡さないと同じミスに毎回違うラベルが付き、弱点リストが名寄せできずに壊れる。

**間隔反復は AI ではなく決定的ロジック**（`lib/domain/review.ts`）。
1→3→7→16→35日、誤答でリセット。再現性が要るのでテストで固めている。

**抽出した型は未承認の下書きとして入る**。ユーザーが承認するまで出題に使わない。
AI の過剰抽出で弱点リストが汚れるのを防ぐ。

## ディレクトリ

```
app/            画面（S1–S9）と API ルート
  api/          16 エンドポイント
mcp/            MCP サーバー（22ツール・AI を持たない）
lib/
  domain/       純粋ロジック（間隔反復・ストリーク・メニュー検証）+ テスト
  ai/           Claude 呼び出し4種 + 構造化出力（API モードでのみ使う）
  services/     材料を集める関数 と 検証して保存する関数。両モードが共有する
  db/           Drizzle スキーマ（17テーブル）
components/     UI コンポーネント
scripts/        study リポジトリからの移行 / MCP 疎通確認
docs/           設計ドキュメント
```

## ドキュメント

| # | ドキュメント | 内容 |
|---|---|---|
| 01 | [コンセプト](docs/01-concept.md) | 課題・提供価値・ターゲット・差別化 |
| 02 | [機能設計](docs/02-features.md) | 機能ブロック A–H、MVP スコープ |
| 03 | [ユーザーフロー](docs/03-user-flows.md) | オンボーディング／日次ループ／弱点ループ |
| 04 | [データモデル](docs/04-data-model.md) | エンティティ・スキーマ・状態遷移 |
| 05 | [画面設計](docs/05-screens.md) | 画面一覧と構成要素 |
| 06 | [アーキテクチャ](docs/06-architecture.md) | 技術構成・AI 部分の設計 |
| 07 | [ロードマップ](docs/07-roadmap.md) | フェーズ計画・名称の経緯 |
| 08 | [デザイントークン](docs/08-design-tokens.md) | 色・タイポ・スペーシング |

デザイン（Figma）: https://www.figma.com/design/R8cfHX7hn1fUhSiol5Ja8K

## ステータス

Phase 1（MVP・単一ユーザー）実装済み。認証はまだ無く、`IKKOMA_USER_ID` の1人で動く。
スキーマは最初から `user_id` で分離してあるので、Phase 2 の複数人対応は認証と RLS の追加で足りる。

いまは **MCP モードで運用**する想定（API キー不要）。Phase 2 で複数人に開くとき、
`lib/ai/*` を再接続するだけで API モードに移れる。捨てる作業はない。
