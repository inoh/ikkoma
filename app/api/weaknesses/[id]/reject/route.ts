import { handle } from "@/lib/http";
import { rejectWeakness } from "@/lib/services/weakness";

export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    await rejectWeakness(id);
    return { ok: true };
  });
}
