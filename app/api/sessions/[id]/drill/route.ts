import { ctx, handle } from "@/lib/http";
import { issueDrill } from "@/lib/services/session";

export const maxDuration = 60;

export function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { userId, today } = ctx();
    const { id } = await params;
    return issueDrill(id, userId, today);
  });
}
