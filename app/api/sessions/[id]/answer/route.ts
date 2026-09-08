import { ctx, handle } from "@/lib/http";
import { answerDrill } from "@/lib/services/session";

export function POST(req: Request) {
  return handle(async () => {
    const { today } = ctx();
    const { attemptId, answer } = await req.json();
    return answerDrill(attemptId, answer, today);
  });
}
