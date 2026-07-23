import type { VercelRequest, VercelResponse } from "@vercel/node";
import { upsertParticipant, deleteParticipant, readBody, json } from "./_lib";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "DELETE") {
      const code = (req.query.code as string) || "";
      if (!code) return json(res, { error: "code required" }, 400);
      await deleteParticipant(code);
      return json(res, { ok: true });
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = await readBody(req);
      const code = String(body.code || "").trim();
      const name = String(body.name || "").trim();
      const choices: string[] = Array.isArray(body.choices) ? body.choices.map(String) : [];
      if (!/^\d{9}$/.test(code)) return json(res, { error: "code must be 9 digits" }, 400);
      if (!name) return json(res, { error: "name required" }, 400);
      await upsertParticipant(code, name, choices);
      return json(res, { ok: true });
    }

    return json(res, { error: "method not allowed" }, 405);
  } catch (e: any) {
    return json(res, { error: e.message }, 500);
  }
}
