import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, date, jsonb, index, unique,
} from "drizzle-orm/pg-core";

/* ---------- enums ---------- */
export const topicStatus = pgEnum("topic_status", ["active", "paused", "done"]);
export const blockKind = pgEnum("block_kind", ["drill", "writing_check", "oral_quiz", "reading", "review"]);
export const menuItemStatus = pgEnum("menu_item_status", ["pending", "done", "skipped"]);
export const menuSource = pgEnum("menu_source", ["auto", "user_request"]);
export const sessionState = pgEnum("session_state", ["in_progress", "completed", "abandoned"]);
export const weaknessStatus = pgEnum("weakness_status", ["active", "mastered", "dismissed"]);
export const weaknessOrigin = pgEnum("weakness_origin", ["correction", "attempt", "manual"]);
export const weaknessEventKind = pgEnum("weakness_event_kind", ["new", "recurrence", "cleared"]);
export const rhythmRole = pgEnum("rhythm_role", ["main", "warmup", "weekly_review"]);
export const notificationKind = pgEnum("notification_kind", ["noon", "night"]);
export const notificationChannel = pgEnum("notification_channel", ["web_push", "line", "slack", "email"]);

/* ---------- users ---------- */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("Asia/Tokyo"),
  dailyGoalMinutes: integer("daily_goal_minutes").notNull().default(30),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- topics ---------- */
export const topics = pgTable("topics", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  status: topicStatus("status").notNull().default("active"),
  /** 現在地メモ。メニュー生成の最重要入力なので構造化せずフリーテキストで持つ */
  currentState: text("current_state").notNull().default(""),
  /** 「次の一手」(30分単位) の配列 */
  nextActions: jsonb("next_actions").$type<string[]>().notNull().default([]),
  progress: integer("progress").notNull().default(0),
  colorToken: text("color_token").notNull().default("topic/1"),
  pausedReason: text("paused_reason"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("topics_user_status_idx").on(t.userId, t.status)]);

export const milestones = pgTable("milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  orderIndex: integer("order_index").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("milestones_topic_order_idx").on(t.topicId, t.orderIndex)]);

/** 定番メニュー: トピックごとの30分の型 */
export const topicMenuTemplates = pgTable("topic_menu_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  blockKind: blockKind("block_kind").notNull(),
  minutes: integer("minutes").notNull(),
  instruction: text("instruction").notNull(),
  orderIndex: integer("order_index").notNull(),
});

/* ---------- weekly rhythm ---------- */
export const rhythmPhases = pgTable("rhythm_phases", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  switchCondition: text("switch_condition"),
});

export const rhythmSlots = pgTable("rhythm_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  phaseId: uuid("phase_id").notNull().references(() => rhythmPhases.id, { onDelete: "cascade" }),
  /** 0=Sun .. 6=Sat */
  weekday: integer("weekday").notNull(),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  role: rhythmRole("role").notNull().default("main"),
});

/* ---------- daily menu ---------- */
export const dailyMenus = pgTable("daily_menus", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  totalMinutes: integer("total_minutes").notNull(),
  source: menuSource("source").notNull().default("auto"),
  regeneratedCount: integer("regenerated_count").notNull().default(0),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("daily_menus_user_date_uq").on(t.userId, t.date)]);

export const menuItems = pgTable("menu_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  menuId: uuid("menu_id").notNull().references(() => dailyMenus.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  blockKind: blockKind("block_kind").notNull(),
  minutes: integer("minutes").notNull(),
  title: text("title").notNull(),
  /** 「何を・どうやって・どこまで」を必ず含む。生成時にバリデータで検証する */
  instruction: text("instruction").notNull(),
  /** この項目で消化する弱点型（間隔反復キューからの投入分） */
  reviewTypeIds: jsonb("review_type_ids").$type<string[]>().notNull().default([]),
  orderIndex: integer("order_index").notNull(),
  status: menuItemStatus("status").notNull().default("pending"),
}, (t) => [index("menu_items_menu_order_idx").on(t.menuId, t.orderIndex)]);

/* ---------- sessions ---------- */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  menuItemId: uuid("menu_item_id").references(() => menuItems.id, { onDelete: "set null" }),
  state: sessionState("state").notNull().default("in_progress"),
  summary: text("summary"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
}, (t) => [index("sessions_user_started_idx").on(t.userId, t.startedAt)]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("messages_session_idx").on(t.sessionId, t.createdAt)]);

export const attempts = pgTable("attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  choices: jsonb("choices").$type<{ key: string; text: string }[]>(),
  userAnswer: text("user_answer"),
  correctAnswer: text("correct_answer").notNull(),
  isCorrect: boolean("is_correct"),
  explanation: text("explanation").notNull(),
  /** この問題が狙った弱点型。間隔反復の消化判定に使う */
  targetTypeIds: jsonb("target_type_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("attempts_session_idx").on(t.sessionId)]);

/** 自由記述の添削 = 弱点抽出の主戦場 */
export const corrections = pgTable("corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  userText: text("user_text").notNull(),
  correctedText: text("corrected_text").notNull(),
  diff: jsonb("diff").$type<{ wrong: string; right: string; note: string }[]>().notNull().default([]),
  feedback: text("feedback").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("corrections_session_idx").on(t.sessionId)]);

/* ---------- weakness (core) ---------- */
export const weaknessTypes = pgTable("weakness_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  topicId: uuid("topic_id").notNull().references(() => topics.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  exampleWrong: text("example_wrong"),
  exampleRight: text("example_right"),
  /** 再発回数。出題重みの主因子 */
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  status: weaknessStatus("status").notNull().default("active"),
  origin: weaknessOrigin("origin").notNull().default("correction"),
  /** AI 抽出をユーザーが承認したか。false は下書き扱いで出題に使わない */
  approved: boolean("approved").notNull().default(false),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("weakness_types_topic_status_idx").on(t.topicId, t.status)]);

export const weaknessEvents = pgTable("weakness_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  typeId: uuid("type_id").notNull().references(() => weaknessTypes.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  kind: weaknessEventKind("kind").notNull(),
  evidence: text("evidence"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("weakness_events_type_idx").on(t.typeId, t.occurredAt)]);

/** 間隔反復の状態。weakness_types と 1:1 */
export const reviewState = pgTable("review_state", {
  typeId: uuid("type_id").primaryKey().references(() => weaknessTypes.id, { onDelete: "cascade" }),
  /** 0..4 → 1, 3, 7, 16, 35 日 */
  intervalStep: integer("interval_step").notNull().default(0),
  /** この日付が来たらメニューに自動投入される */
  dueOn: date("due_on").notNull(),
  consecutiveCorrect: integer("consecutive_correct").notNull().default(0),
  lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
}, (t) => [index("review_state_due_idx").on(t.dueOn)]);

/* ---------- streak / notifications ---------- */
export const streaks = pgTable("streaks", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  totalDays: integer("total_days").notNull().default(0),
  lastStudiedOn: date("last_studied_on"),
});

export const notificationSettings = pgTable("notification_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: notificationKind("kind").notNull(),
  time: text("time").notNull(),
  channel: notificationChannel("channel").notNull().default("web_push"),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => [unique("notification_settings_user_kind_uq").on(t.userId, t.kind)]);

export type Topic = typeof topics.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type MenuItem = typeof menuItems.$inferSelect;
export type WeaknessType = typeof weaknessTypes.$inferSelect;
export type ReviewState = typeof reviewState.$inferSelect;
export type Streak = typeof streaks.$inferSelect;
export type Session = typeof sessions.$inferSelect;
