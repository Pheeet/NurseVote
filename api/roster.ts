import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getRoster,
  rosterName,
  replaceRoster,
  validateRoster,
  readBody,
  json,
  fail,
  isAdminReq,
  requireIdentity,
} from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    res.setHeader("Cache-Control", "private, no-store");

    if (req.method === "GET") {
      const code = String(req.query.code || "");
      if (code) {
        // name auto-fill: ต้อง login (จำกัดการ scrape) — ไม่บอกสถานะลงทะเบียน จึงไม่เป็น oracle ให้ squatter
        if (!/^\d{9}$/.test(code)) return json(res, { error: "code must be 9 digits" }, 400);
        await requireIdentity(req);
        return json(res, await rosterName(code));
      }
      // ทั้ง roster = admin เท่านั้น
      if (!isAdminReq(req)) return json(res, { error: "admin only" }, 401);
      return json(res, await getRoster());
    }

    if (req.method === "PUT" || req.method === "POST") {
      if (!isAdminReq(req)) return json(res, { error: "admin only" }, 401);
      const body = await readBody(req);
      const entries = validateRoster(body.roster);
      await replaceRoster(entries);
      return json(res, { ok: true, count: entries.length });
    }

    return json(res, { error: "method not allowed" }, 405);
  } catch (e: any) {
    return fail(res, e);
  }
}
