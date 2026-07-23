import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resetAll, json } from "./_lib";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return json(res, { error: "method not allowed" }, 405);
    await resetAll();
    return json(res, { ok: true });
  } catch (e: any) {
    return json(res, { error: e.message }, 500);
  }
}
