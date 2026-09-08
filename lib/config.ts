/** MVP は単一ユーザー。Phase 2 で認証を入れるまでは env の user id を使う */
export function currentUserId(): string {
  const id = process.env.IKKOMA_USER_ID;
  if (!id) {
    throw new Error(
      "IKKOMA_USER_ID が未設定です。`npm run db:seed` が出力した UUID を .env に入れてください。",
    );
  }
  return id;
}

export const DEFAULT_TIMEZONE = "Asia/Tokyo";
