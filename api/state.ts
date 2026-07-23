import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getState, json } from "./_lib.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    return json(res, await getState());
  } catch (e: any) {
    return json(res, { error: e.message }, 500);
  }
}
