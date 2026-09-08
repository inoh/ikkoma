import { handle } from "@/lib/http";
import { completeTopic, pauseTopic, resumeTopic, toggleMilestone, topicDetail } from "@/lib/services/topics";

export const dynamic = "force-dynamic";

export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => topicDetail((await params).id));
}

/** action = pause | resume | complete | toggle_milestone */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const body = await req.json();
    switch (body.action) {
      case "pause": return pauseTopic(id, body.reason ?? "");
      case "resume": return resumeTopic(id);
      case "complete": return completeTopic(id);
      case "toggle_milestone": return toggleMilestone(body.milestoneId, body.done);
      default: throw new Error(`unknown action: ${body.action}`);
    }
  });
}
