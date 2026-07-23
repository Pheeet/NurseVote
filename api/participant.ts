import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  saveParticipant,
  removeParticipant,
  participantExists,
  readBody,
  json,
  fail,
  isAdminReq,
  participantToken,
} from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "GET") {
      const code = String(req.query.exists || "");
      if (!/^\d{9}$/.test(code)) return json(res, { error: "code must be 9 digits" }, 400);
      return json(res, await participantExists(code));
    }

    if (req.method === "DELETE") {
      const code = (req.query.code as string) || "";
      if (!code) return json(res, { error: "code required" }, 400);
      const result = await removeParticipant(code, {
        token: participantToken(req),
        admin: isAdminReq(req),
      });
      return json(res, result);
    }

    if (req.method === "PUT" || req.method === "POST") {
      const body = await readBody(req);
      const code = String(body.code || "").trim();
      const name = String(body.name || "").trim();
      const choices: string[] = Array.isArray(body.choices) ? body.choices.map(String) : [];
      if (!/^\d{9}$/.test(code)) return json(res, { error: "code must be 9 digits" }, 400);
      if (!name) return json(res, { error: "name required" }, 400);
      const result = await saveParticipant(code, name, choices, {
        token: participantToken(req),
        admin: isAdminReq(req),
      });
      return json(res, result);
    }

    return json(res, { error: "method not allowed" }, 405);
  } catch (e: any) {
    return fail(res, e);
  }
}
