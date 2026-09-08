import { ctx, handle } from "@/lib/http";
import { getMenu } from "@/lib/services/menu";
import { db } from "@/lib/db";
import { streaks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { dueWeaknesses } from "@/lib/services/weakness";
import { activeTopics } from "@/lib/services/topics";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const { userId, today } = ctx();
    const [menu, [streak], due, topics] = await Promise.all([
      getMenu(userId, today),
      db.select().from(streaks).where(eq(streaks.userId, userId)),
      dueWeaknesses(userId, today),
      activeTopics(userId),
    ]);
    return { today, menu, streak: streak ?? null, dueCount: due.length, topics };
  });
}
