import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

/**
 * 本番 (Vercel + Neon) は HTTP ドライバでコネクションを張らない = スケール・トゥ・ゼロと相性が良い。
 * ローカルの postgres@14 はそのままだと Neon ドライバで喋れないので postgres.js に切り替える。
 */
const isNeon = /neon\.tech|neon\.build/.test(url);

export const db = isNeon
  ? drizzleNeon(neon(url), { schema })
  : drizzlePg(postgres(url, { max: 1 }), { schema });

export { schema };
