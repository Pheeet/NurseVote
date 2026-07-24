import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getMe, requireIdentity, json, fail } from "./_lib.js";

// GET /api/me — คืนการลงทะเบียนของบัญชี Google ที่ login อยู่ (รหัสเต็ม, ของตัวเองเท่านั้น)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return json(res, { error: "method not allowed" }, 405);
    res.setHeader("Cache-Control", "private, no-store"); // ผูกกับตัวตน — ห้าม CDN cache
    const identity = await requireIdentity(req);
    return json(res, await getMe(identity));
  } catch (e: any) {
    return fail(res, e);
  }
}
