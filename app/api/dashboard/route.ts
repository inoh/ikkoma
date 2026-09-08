import { ctx, handle } from "@/lib/http";
import { dashboard } from "@/lib/services/dashboard";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => {
    const { userId, today } = ctx();
    return dashboard(userId, today);
  });
}
