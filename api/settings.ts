import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  saveSettings,
  validateSettings,
  setRegistrationOpen,
  readBody,
  json,
  fail,
  isAdminReq,
} from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!isAdminReq(req)) return json(res, { error: "admin only" }, 401);
    if (req.method !== "PUT" && req.method !== "POST") {
      return json(res, { error: "method not allowed" }, 405);
    }
    const body = await readBody(req);
    // toggle Registration Window (แยกจากการแก้ term/year)
    if (typeof body.registrationOpen === "boolean") {
      await setRegistrationOpen(body.registrationOpen);
      return json(res, { ok: true });
    }
    const { term, year, title } = validateSettings(body.term, body.year, body.title);
    await saveSettings(term, year, title);
    return json(res, { ok: true });
  } catch (e: any) {
    return fail(res, e);
  }
}
