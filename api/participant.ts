import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  saveParticipant,
  removeParticipant,
  readBody,
  json,
  fail,
  isAdminReq,
  verifyIdentity,
} from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const admin = isAdminReq(req);
    const identity = await verifyIdentity(req); // null ถ้าไม่ได้ login (admin ใช้ x-admin-key แทน)

    if (req.method === "DELETE") {
      const code = (req.query.code as string) || "";
      if (!code) return json(res, { error: "code required" }, 400);
      return json(res, await removeParticipant(code, { identity: identity ?? undefined, admin }));
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = await readBody(req);
      const code = String(body.code || "").trim();
      const name = String(body.name || "").trim();
      const choices: string[] = Array.isArray(body.choices) ? body.choices.map(String) : [];
      if (!/^\d{9}$/.test(code)) return json(res, { error: "code must be 9 digits" }, 400);
      const result = await saveParticipant(code, name, choices, {
        identity: identity ?? undefined,
        admin,
      });
      return json(res, result);
    }

    return json(res, { error: "method not allowed" }, 405);
  } catch (e: any) {
    return fail(res, e);
  }
}
