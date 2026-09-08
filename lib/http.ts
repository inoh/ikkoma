import { NextResponse } from "next/server";
import { currentUserId, DEFAULT_TIMEZONE } from "@/lib/config";
import { todayInTz } from "@/lib/domain/menu";

export function ctx() {
  return { userId: currentUserId(), today: todayInTz(DEFAULT_TIMEZONE) };
}

export function ok<T>(data: T) {
  return NextResponse.json(data);
}

/** AI 呼び出しやDBの失敗をそのまま500で返す。原因が読めないと運用できないのでメッセージは残す */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
