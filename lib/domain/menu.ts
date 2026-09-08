/**
 * メニュー生成のバリデータ。
 * docs/02-features.md「C. 日次メニュー生成」の制約:
 *   「勉強する」のような曖昧な項目を出力してはいけない。
 *   必ず対象・方法・完了条件を含み、合計時間が目標±5分に収まること。
 */

export type DraftMenuItem = {
  topicId: string;
  blockKind: "drill" | "writing_check" | "oral_quiz" | "reading" | "review";
  minutes: number;
  title: string;
  instruction: string;
  reviewTypeIds?: string[];
};

export const TOTAL_MINUTES_TOLERANCE = 5;
const MIN_INSTRUCTION_LENGTH = 20;

/** 完了条件を示すシグナル。どれか1つは含まれていないと「どこまで」が不明 */
const COMPLETION_SIGNALS = [
  "問", "文", "個", "語", "分", "回", "ページ", "章", "段落", "まで", "ずつ",
  "書く", "答える", "説明", "解く", "音読", "要約", "列挙",
];

/** 曖昧すぎて弾くべき表現 */
const VAGUE_PATTERNS = [
  /^\s*勉強(する)?\s*$/,
  /^\s*学習(する)?\s*$/,
  /^\s*復習(する)?\s*$/,
  /^\s*やる\s*$/,
  /^\s*進める\s*$/,
  /^\s*(頑張|がんば)る\s*$/,
];

export type ValidationIssue = { index: number; field: string; message: string };

export function validateMenu(
  items: DraftMenuItem[],
  goalMinutes: number,
  knownTopicIds: string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (items.length === 0) {
    issues.push({ index: -1, field: "items", message: "メニュー項目が空です" });
    return issues;
  }

  items.forEach((item, i) => {
    if (!knownTopicIds.includes(item.topicId)) {
      issues.push({ index: i, field: "topicId", message: `未知のトピック: ${item.topicId}` });
    }
    if (!Number.isInteger(item.minutes) || item.minutes <= 0 || item.minutes > goalMinutes) {
      issues.push({ index: i, field: "minutes", message: `minutes が不正: ${item.minutes}` });
    }
    if (VAGUE_PATTERNS.some((p) => p.test(item.title))) {
      issues.push({ index: i, field: "title", message: `曖昧なタイトル: 「${item.title}」` });
    }
    const inst = item.instruction.trim();
    if (inst.length < MIN_INSTRUCTION_LENGTH) {
      issues.push({
        index: i, field: "instruction",
        message: `instruction が短すぎます（${inst.length}字）。何を・どうやって・どこまでを書くこと`,
      });
    } else if (!COMPLETION_SIGNALS.some((s) => inst.includes(s))) {
      issues.push({
        index: i, field: "instruction",
        message: "完了条件が読み取れません（「10問」「2文」「1段落で説明する」等を含めること）",
      });
    }
  });

  const total = items.reduce((sum, i) => sum + i.minutes, 0);
  if (Math.abs(total - goalMinutes) > TOTAL_MINUTES_TOLERANCE) {
    issues.push({
      index: -1, field: "totalMinutes",
      message: `合計 ${total} 分。目標 ${goalMinutes} 分 ±${TOTAL_MINUTES_TOLERANCE} に収めること`,
    });
  }

  return issues;
}

/** 曜日 (0=Sun..6=Sat) をローカルタイムゾーンで求める */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function todayInTz(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}
