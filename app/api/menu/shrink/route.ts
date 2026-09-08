import { ctx, handle } from "@/lib/http";
import { shrinkToFiveMinutes } from "@/lib/services/menu";

export function POST() {
  return handle(async () => {
    const { userId, today } = ctx();
    return shrinkToFiveMinutes(userId, today);
  });
}
