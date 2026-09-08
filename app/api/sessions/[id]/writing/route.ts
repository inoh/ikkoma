import { ctx, handle } from "@/lib/http";
import { submitWriting } from "@/lib/services/session";

export const maxDuration = 60;

export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { userId } = ctx();
    const { id } = await params;
    const { text } = await req.json();
    return submitWriting(id, userId, text);
  });
}
