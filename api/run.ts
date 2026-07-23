import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAdmission, getRunsHistory, json } from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      return json(res, await getRunsHistory());
    }
    if (req.method === "POST") {
      const result = await runAdmission();
      return json(res, result);
    }
    return json(res, { error: "method not allowed" }, 405);
  } catch (e: any) {
    return json(res, { error: e.message }, 500);
  }
}
