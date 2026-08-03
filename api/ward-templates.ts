import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  listWardTemplates,
  saveWardTemplate,
  deleteWardTemplate,
  validateTemplate,
  readBody,
  json,
  fail,
  isAdminReq,
} from "./_lib.js";

// Admin-only CRUD สำหรับ preset วอร์ด
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!isAdminReq(req)) return json(res, { error: "admin only" }, 401);

    if (req.method === "GET") {
      return json(res, await listWardTemplates());
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = await readBody(req);
      await saveWardTemplate(validateTemplate(body));
      return json(res, { ok: true });
    }

    if (req.method === "DELETE") {
      const id = String(req.query?.id ?? "");
      if (!id) return json(res, { error: "id required" }, 400);
      await deleteWardTemplate(id);
      return json(res, { ok: true });
    }

    return json(res, { error: "method not allowed" }, 405);
  } catch (e: any) {
    return fail(res, e);
  }
}
