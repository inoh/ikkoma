import { notFound } from "next/navigation";
import { getSession } from "@/lib/services/session";
import { SessionView } from "@/components/SessionView";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession(id);
  if (!s) notFound();
  return <SessionView initial={JSON.parse(JSON.stringify(s))} />;
}
