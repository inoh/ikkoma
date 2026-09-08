import { ctx, handle } from "@/lib/http";
import { ensureMenu } from "@/lib/services/menu";

export const maxDuration = 60;

export function POST(req: Request) {
  return handle(async () => {
    const { userId, today } = ctx();
    const force = new URL(req.url).searchParams.get("force") === "1";
    const menu = await ensureMenu(userId, today, force);
    if (!menu) return { menu: null, reason: "active なトピックがありません" };
    return menu;
  });
}
