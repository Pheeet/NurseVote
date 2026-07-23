import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAdmission, json } from "./_lib";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return json(res, { error: "method not allowed" }, 405);
    const result = await runAdmission();
    return json(res, result);
  } catch (e: any) {
    return json(res, { error: e.message }, 500);
  }
}
