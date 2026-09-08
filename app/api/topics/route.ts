import { ctx, handle } from "@/lib/http";
import { listTopics } from "@/lib/services/topics";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const { userId } = ctx();
    return listTopics(userId);
  });
}
