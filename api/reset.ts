import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resetScope, json, fail, isAdminReq } from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!isAdminReq(req)) return json(res, { error: "admin only" }, 401);
    if (req.method !== "POST") return json(res, { error: "method not allowed" }, 405);
    // scope: all | participants | runs | wards | roster (default = all เพื่อ backward compat)
    const scope = (req.query.scope as string) || "all";
    await resetScope(scope);
    return json(res, { ok: true });
  } catch (e: any) {
    return fail(res, e);
  }
}
