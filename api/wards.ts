import type { VercelRequest, VercelResponse } from "@vercel/node";
import { replaceWards, readBody, json, fail, isAdminReq, type Ward } from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!isAdminReq(req)) return json(res, { error: "admin only" }, 401);
    if (req.method !== "PUT" && req.method !== "POST") {
      return json(res, { error: "method not allowed" }, 405);
    }
    const body = await readBody(req);
    const wards: Ward[] = Array.isArray(body.wards) ? body.wards : [];
    await replaceWards(wards);
    return json(res, { ok: true });
  } catch (e: any) {
    return fail(res, e);
  }
}
