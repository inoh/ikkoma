# 04. データモデル

## ER 概観

```
users ─┬─< topics ─┬─< milestones
       │           ├─< topic_menu_templates   (定番メニュー)
       │           └─< weakness_types ─┬─< weakness_events
       │                               └── review_state   (1:1)
       ├─< rhythm_phases ─< rhythm_slots
       ├─< daily_menus ─< menu_items ─── sessions
       ├─< sessions ─┬─< attempts
       │             ├─< corrections
       │             └─< messages
       ├─── streak    (1:1)
       └─< notification_settings

Phase 2:
users ─< memberships >─ groups
topics ─< topic_shares >─ users        (メンター共有)
topic_templates  (公開テンプレート)
```

すべてのテーブルは `user_id` を持ち、行レベルで分離する（Phase 2 の複数人化に備える）。
MVP でも最初から `user_id` を入れておく。後付けは高くつく。

---

## 主要エンティティ

### topics
学習テーマ1つ。

| 列 | 型 | 説明 |
|---|---|---|
| id | uuid | |
| user_id | uuid | |
| title | text | 例: "TOEIC" |
| goal | text | 例: "TOEIC 600点取得" |
| status | enum | `active` / `paused` / `done` |
| current_state | text | **現在地メモ**。メニュー生成の最重要入力 |
| next_actions | jsonb | 「次の一手」の配列（30分単位） |
| progress | int | 0–100 |
| paused_reason | text | paused 時のみ |
| started_at / paused_at / completed_at | timestamptz | |

> `current_state` を構造化せずフリーテキストにしているのは意図的。
> 学習の現在地は列挙できない。LLM への入力としてはテキストのほうが強い。

### milestones

| 列 | 型 | 説明 |
|---|---|---|
| id / topic_id | uuid | |
| code | text | "M1", "M2" … |
| title | text | 例: "基礎固め(文法・頻出単語)" |
| detail | text | サブ項目・優先順 |
| order_index | int | |
| completed_at | timestamptz | null なら未完了 |

`is_current` は持たない。**未完了のうち order_index 最小＝現在のマイルストーン**として導出する。

### topic_menu_templates
「定番メニュー」（A-4）。トピックごとの30分の型。

| 列 | 型 | 説明 |
|---|---|---|
| topic_id | uuid | |
| block_kind | enum | `drill` / `writing_check` / `oral_quiz` / `reading` / `review` |
| minutes | int | |
| instruction | text | AI へのブロック単位の指示 |
| order_index | int | |

---

### rhythm_phases / rhythm_slots
週次リズム（B）。

**rhythm_phases**：`name`, `is_active`, `switch_condition`(text, 例: "AgentCore M2 完了")
**rhythm_slots**：`phase_id`, `weekday`(0–6), `topic_id`, `role`(`main` / `warmup` / `weekly_review`)

`role = warmup` が「AgentCore の日も冒頭5分は TOEIC」を表現する。

---

### daily_menus / menu_items
生成された今日のメニュー（C）。

**daily_menus**：`user_id`, `date`, `total_minutes`, `generated_at`, `regenerated_count`, `source`(`auto`/`user_request`)

**menu_items**

| 列 | 型 | 説明 |
|---|---|---|
| menu_id | uuid | |
| topic_id | uuid | |
| block_kind | enum | 上記と同じ |
| minutes | int | |
| title | text | 例: "昨日の弱点3型を再テスト" |
| instruction | text | 「何を・どうやって・どこまで」を含む具体指示 |
| review_type_ids | uuid[] | この項目で消化する弱点型（E-3 からの投入分） |
| status | enum | `pending` / `done` / `skipped` |

**制約**：`instruction` は空でも汎用文でもいけない。生成時にバリデータで弾く（02 の制約参照）。

---

### sessions / attempts / corrections
実際の学習実施記録（D）。

**sessions**：`user_id`, `topic_id`, `menu_item_id`, `started_at`, `ended_at`, `duration_minutes`, `summary`(text, AI 生成), `state`(`in_progress`/`completed`/`abandoned`)

**messages**（セッション中の対話ログ。実装時に追加）
`session_id`, `role`(`user`/`assistant`), `content`, `created_at`

**attempts**（ドリルの1問1答）

| 列 | 型 | 説明 |
|---|---|---|
| session_id | uuid | |
| question | text | AI がその場で生成した問題 |
| choices | jsonb | 選択式の場合 |
| user_answer | text | |
| correct_answer | text | |
| is_correct | bool | |
| explanation | text | AI の解説 |
| target_type_ids | uuid[] | この問題が狙った弱点型（間隔反復の消化判定に使う） |

**corrections**（自由記述の添削 = 弱点抽出の主戦場）

| 列 | 型 | 説明 |
|---|---|---|
| session_id | uuid | |
| user_text | text | ユーザーが書いた文 |
| corrected_text | text | 添削後 |
| diff | jsonb | 差分（型抽出の入力） |
| feedback | text | 講評 |

---

### weakness_types（弱点の型）★中核

| 列 | 型 | 説明 |
|---|---|---|
| id / topic_id | uuid | |
| label | text | 例: "冠詞の付け忘れ" |
| description | text | 例: "数えられる単数名詞には限定詞が必須" |
| example_wrong / example_right | text | 例: "× checked mail" / "○ checked the email" |
| occurrence_count | int | **再発回数。出題重みの主因子** |
| first_seen_at / last_seen_at | timestamptz | |
| status | enum | `active` / `mastered` / `dismissed` |
| origin | enum | `correction` / `attempt` / `manual` |
| approved | bool | AI 抽出をユーザーが承認したか（false は下書き扱い） |

**weakness_events**：型が発生／再発／正解した個別イベント。
`type_id`, `session_id`, `kind`(`new`/`recurrence`/`cleared`), `occurred_at`, `evidence`(text)

### review_state（間隔反復の状態。weakness_types と 1:1）

| 列 | 型 | 説明 |
|---|---|---|
| type_id | uuid | PK |
| interval_step | int | 0..4 → 1, 3, 7, 16, 35 日 |
| due_on | date | **この日付が来たらメニューに自動投入** |
| consecutive_correct | int | |
| last_reviewed_at | timestamptz | |

**遷移ルール**
- 正解：`interval_step += 1`（上限4）、`due_on = today + INTERVALS[step]`、`consecutive_correct += 1`
- 誤答：`interval_step = 0`、`due_on = today + 1`、`consecutive_correct = 0`、`occurrence_count += 1`
- `consecutive_correct >= 3` かつ `interval_step = 4` → `status = mastered`（キューから除外）

---

### streak（users と 1:1）

`current_streak`, `longest_streak`, `total_days`, `last_studied_on`

**更新ルール**（セッション完了時、日付単位で冪等に）
```
if last_studied_on == today:        変更なし
elif last_studied_on == yesterday:  current += 1
else:                               current = 1
longest = max(longest, current)
total_days += 1  (今日が初回なら)
```

### notification_settings
`user_id`, `kind`(`noon`/`night`), `time`, `timezone`, `channel`(`web_push`/`line`/`slack`/`email`), `enabled`

---

## Phase 2 の追加

- **groups / memberships**：グループストリーク（H-4）
- **topic_shares**：`topic_id`, `viewer_user_id`, `scope`(`log_only`/`full`) — メンター共有（H-3）
- **topic_templates**：`source_topic_id`, `title`, `goal`, `milestones`(jsonb), `menu_template`(jsonb), `is_public`, `fork_count`
  - **ログや弱点リストはコピーしない**。進め方だけを複製する

## 導出値（テーブルに持たない）

保存しないで都度計算するもの。二重管理を避ける。

| 値 | 導出元 |
|---|---|
| 現在のマイルストーン | milestones の未完了・最小 order_index |
| トピック進捗% | 完了マイルストーン数 / 全体（手動上書きも可） |
| 今日の残り時間 | menu_items の pending 分の合計 |
| ヒートマップ | sessions を日付で集計 |
| 今日の復習キュー | review_state where due_on <= today and status = active |
