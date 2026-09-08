import { ctx, handle } from "@/lib/http";
import { proposeMilestones } from "@/lib/ai/onboarding";
import { createTopic } from "@/lib/services/topics";

export const maxDuration = 60;

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
    return createTopic(userId, await req.json());
  });
}
