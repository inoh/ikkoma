import { handle } from "@/lib/http";
import { getSession } from "@/lib/services/session";

export const dynamic = "force-dynamic";

export function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => getSession((await params).id));
}
