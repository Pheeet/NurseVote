import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resetAll, json, fail, isAdminReq } from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!isAdminReq(req)) return json(res, { error: "admin only" }, 401);
    if (req.method !== "POST") return json(res, { error: "method not allowed" }, 405);
    await resetAll();
    return json(res, { ok: true });
  } catch (e: any) {
    return fail(res, e);
  }
}
