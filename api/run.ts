import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAdmission, getRunsHistory, json, fail, isAdminReq } from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      if (!isAdminReq(req)) return json(res, { error: "admin only" }, 401);
      return json(res, await getRunsHistory());
    }
    if (req.method === "POST") {
      if (!isAdminReq(req)) return json(res, { error: "admin only" }, 401);
      const result = await runAdmission();
      return json(res, result);
    }
    return json(res, { error: "method not allowed" }, 405);
  } catch (e: any) {
    return fail(res, e);
  }
}
