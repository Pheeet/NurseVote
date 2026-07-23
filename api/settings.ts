import type { VercelRequest, VercelResponse } from "@vercel/node";
import { saveSettings, readBody, json } from "./_lib";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "PUT" && req.method !== "POST") {
      return json(res, { error: "method not allowed" }, 405);
    }
    const body = await readBody(req);
    const term = String(body.term ?? "").trim();
    const year = String(body.year ?? "").trim();
    if (!term || !year) return json(res, { error: "term and year required" }, 400);
    await saveSettings(term, year);
    return json(res, { ok: true });
  } catch (e: any) {
    return json(res, { error: e.message }, 500);
  }
}
