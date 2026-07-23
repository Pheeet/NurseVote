// Local dev API server (mirrors /api handlers) so `npm run dev` works
// without the Vercel CLI. Runs on :5180, proxied by Vite.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import {
  getState,
  upsertParticipant,
  deleteParticipant,
  replaceWards,
  runAdmission,
  resetAll,
  saveSettings,
  getRunsHistory,
  type Ward,
} from "../api/_lib.ts";

const env = new URL("../.env", import.meta.url);
if (existsSync(env))
  for (const line of readFileSync(env, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].trim();
  }

const send = (res: http.ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};
const readBody = (req: http.IncomingMessage) =>
  new Promise<any>((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname;
  const m = req.method;
  try {
    if (p === "/api/state" && m === "GET") return send(res, await getState());

    if (p === "/api/participant") {
      if (m === "DELETE") {
        const code = url.searchParams.get("code") || "";
        if (!code) return send(res, { error: "code required" }, 400);
        await deleteParticipant(code);
        return send(res, { ok: true });
      }
      if (m === "PUT" || m === "POST") {
        const b = await readBody(req);
        const code = String(b.code || "").trim();
        const name = String(b.name || "").trim();
        const choices: string[] = Array.isArray(b.choices) ? b.choices.map(String) : [];
        if (!/^\d{9}$/.test(code)) return send(res, { error: "code must be 9 digits" }, 400);
        if (!name) return send(res, { error: "name required" }, 400);
        await upsertParticipant(code, name, choices);
        return send(res, { ok: true });
      }
    }

    if (p === "/api/wards" && (m === "PUT" || m === "POST")) {
      const b = await readBody(req);
      await replaceWards((b.wards as Ward[]) ?? []);
      return send(res, { ok: true });
    }
    if (p === "/api/settings" && (m === "PUT" || m === "POST")) {
      const b = await readBody(req);
      const term = String(b.term ?? "").trim();
      const year = String(b.year ?? "").trim();
      if (!term || !year) return send(res, { error: "term and year required" }, 400);
      await saveSettings(term, year);
      return send(res, { ok: true });
    }
    if (p === "/api/run" && m === "GET") return send(res, await getRunsHistory());
    if (p === "/api/run" && m === "POST") return send(res, await runAdmission());
    if (p === "/api/reset" && m === "POST") {
      await resetAll();
      return send(res, { ok: true });
    }

    return send(res, { error: "not found", path: p }, 404);
  } catch (e: any) {
    return send(res, { error: e.message }, 500);
  }
});

server.listen(5180, () => console.log("✓ dev api on http://localhost:5180"));
