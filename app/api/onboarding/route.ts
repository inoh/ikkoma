import { ctx, handle } from "@/lib/http";
import { proposeMilestones } from "@/lib/ai/onboarding";
import { db } from "@/lib/db";
import { milestones, topicMenuTemplates, topics } from "@/lib/db/schema";
import { activeTopics } from "@/lib/services/topics";

export const maxDuration = 60;

const COLORS = ["topic/1", "topic/2", "topic/3", "topic/4", "topic/5", "topic/6"];

/** step=propose: マイルストーン提案だけ返す（保存しない） */
export function PUT(req: Request) {
  return handle(async () => {
    const body = await req.json();
    return proposeMilestones({
      goal: body.goal,
      selfReport: body.selfReport ?? "",
      deadline: body.deadline,
      dailyMinutes: body.dailyMinutes ?? 30,
    });
  });
}

/** step=commit: ユーザーが編集した内容で確定保存する */
export function POST(req: Request) {
  return handle(async () => {
    const { userId } = ctx();
    const body = await req.json();

    const actives = await activeTopics(userId);
    const warning = actives.length >= 2
      ? "active が既に2つあります。3つ目は週次リズムが破綻しやすいので、どれかを中断することを勧めます。"
      : null;

    const [t] = await db.insert(topics).values({
      userId, title: body.topicTitle, goal: body.goal,
      currentState: body.currentState ?? "",
      nextActions: body.firstNextAction ? [body.firstNextAction] : [],
      colorToken: COLORS[actives.length % COLORS.length],
    }).returning();

    if (body.milestones?.length) {
      await db.insert(milestones).values(
        body.milestones.map((m: { code: string; title: string; detail?: string }, i: number) => ({
          topicId: t.id, code: m.code, title: m.title, detail: m.detail ?? null, orderIndex: i,
        })),
      );
    }
    if (body.menuTemplate?.length) {
      await db.insert(topicMenuTemplates).values(
        body.menuTemplate.map((b: { blockKind: string; minutes: number; instruction: string }, i: number) => ({
          topicId: t.id, blockKind: b.blockKind as never, minutes: b.minutes,
          instruction: b.instruction, orderIndex: i,
        })),
      );
    }
    return { topic: t, warning };
  });
}
