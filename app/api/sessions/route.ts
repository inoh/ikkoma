import { ctx, handle } from "@/lib/http";
import { startSession } from "@/lib/services/session";

export function POST(req: Request) {
  return handle(async () => {
    const { userId } = ctx();
    const { menuItemId } = await req.json();
    return startSession(userId, menuItemId);
  });
}
