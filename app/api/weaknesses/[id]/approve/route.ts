import { ctx, handle } from "@/lib/http";
import { approveWeakness } from "@/lib/services/weakness";

export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { today } = ctx();
    const { id } = await params;
    await approveWeakness(id, today);
    return { ok: true };
  });
}
