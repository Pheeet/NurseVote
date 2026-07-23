// Local dev API server (mirrors /api handlers) so `npm run dev` works
// without the Vercel CLI. Runs on :5180, proxied by Vite.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import {
  getState,
  replaceWards,
  runAdmission,
  getRunsHistory,
  resetAll,
  saveSettings,
  saveParticipant,
  removeParticipant,
  isAdminReq,
  participantToken,
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
const fail = (res: http.ServerResponse, e: any) => {
  const status = e?.status || 500;
  send(res, { error: status >= 500 ? "server error" : e?.message || "error" }, status);
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const p = url.pathname;
  const m = req.method;
  try {
    if (p === "/api/state" && m === "GET") return send(res, await getState());

    if (p === "/api/participant") {
      const admin = isAdminReq(req);
      const token = participantToken(req);
      if (m === "DELETE") {
        const code = url.searchParams.get("code") || "";
        if (!code) return send(res, { error: "code required" }, 400);
        return send(res, await removeParticipant(code, { token, admin }));
      }
      if (m === "PUT" || m === "POST") {
        const b = await readBody(req);
        const code = String(b.code || "").trim();
        const name = String(b.name || "").trim();
        const choices: string[] = Array.isArray(b.choices) ? b.choices.map(String) : [];
        if (!/^\d{9}$/.test(code)) return send(res, { error: "code must be 9 digits" }, 400);
        if (!name) return send(res, { error: "name required" }, 400);
        return send(res, await saveParticipant(code, name, choices, { token, admin }));
      }
    }

    if (p === "/api/wards" && (m === "PUT" || m === "POST")) {
      if (!isAdminReq(req)) return send(res, { error: "admin only" }, 401);
      const b = await readBody(req);
      await replaceWards((b.wards as Ward[]) ?? []);
      return send(res, { ok: true });
    }
    if (p === "/api/settings" && (m === "PUT" || m === "POST")) {
      if (!isAdminReq(req)) return send(res, { error: "admin only" }, 401);
      const b = await readBody(req);
      const term = String(b.term ?? "").trim();
      const year = String(b.year ?? "").trim();
      if (!term || !year) return send(res, { error: "term and year required" }, 400);
      await saveSettings(term, year);
      return send(res, { ok: true });
    }
    if (p === "/api/run") {
      if (!isAdminReq(req)) return send(res, { error: "admin only" }, 401);
      if (m === "GET") return send(res, await getRunsHistory());
      if (m === "POST") return send(res, await runAdmission());
    }
    if (p === "/api/reset" && m === "POST") {
      if (!isAdminReq(req)) return send(res, { error: "admin only" }, 401);
      await resetAll();
      return send(res, { ok: true });
    }

    return send(res, { error: "not found", path: p }, 404);
  } catch (e: any) {
    return fail(res, e);
  }
});

server.listen(5180, () => console.log("✓ dev api on http://localhost:5180"));
