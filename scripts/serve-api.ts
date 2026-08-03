// Local dev API server (mirrors /api handlers) so `npm run dev` works
// without the Vercel CLI. Runs on :5180, proxied by Vite.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import {
  getState,
  replaceWards,
  validateWards,
  validateSettings,
  runAdmission,
  getRunsHistory,
  resetAll,
  saveSettings,
  saveParticipant,
  removeParticipant,
  getMe,
  getRoster,
  rosterName,
  replaceRoster,
  validateRoster,
  setRegistrationOpen,
  isAdminReq,
  verifyIdentity,
  requireIdentity,
  MAX_BODY_BYTES,
  listWardTemplates,
  saveWardTemplate,
  deleteWardTemplate,
  validateTemplate,
} from "../api/_lib.ts";

const env = new URL("../.env", import.meta.url);
if (existsSync(env))
  for (const line of readFileSync(env, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].trim();
  }

const send = (
  res: http.ServerResponse,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(data));
};
const readBody = (req: http.IncomingMessage) =>
  new Promise<any>((resolve) => {
    let s = "";
    let size = 0;
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // หยุดสะสม + resolve; ไม่ปิด socket เพื่อให้ handler ตอบ 400 ได้
        aborted = true;
        return resolve({});
      }
      s += c;
    });
    req.on("end", () => {
      if (aborted) return;
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
    if (p === "/api/state" && m === "GET") {
      const admin = isAdminReq(req);
      return send(res, await getState({ admin }), 200, {
        "cache-control": admin ? "private, no-store" : "public, s-maxage=3, stale-while-revalidate=30",
      });
    }

    if (p === "/api/me" && m === "GET") {
      const identity = await requireIdentity(req);
      return send(res, await getMe(identity), 200, { "cache-control": "private, no-store" });
    }

    if (p === "/api/roster") {
      if (m === "GET") {
        const code = url.searchParams.get("code") || "";
        if (code) {
          if (!/^\d{9}$/.test(code)) return send(res, { error: "code must be 9 digits" }, 400);
          await requireIdentity(req);
          return send(res, await rosterName(code), 200, { "cache-control": "private, no-store" });
        }
        if (!isAdminReq(req)) return send(res, { error: "admin only" }, 401);
        return send(res, await getRoster(), 200, { "cache-control": "private, no-store" });
      }
      if (m === "PUT" || m === "POST") {
        if (!isAdminReq(req)) return send(res, { error: "admin only" }, 401);
        const b = await readBody(req);
        const entries = validateRoster(b.roster);
        await replaceRoster(entries);
        return send(res, { ok: true, count: entries.length });
      }
    }

    if (p === "/api/participant") {
      const admin = isAdminReq(req);
      const identity = await verifyIdentity(req);
      if (m === "DELETE") {
        const code = url.searchParams.get("code") || "";
        if (!code) return send(res, { error: "code required" }, 400);
        return send(res, await removeParticipant(code, { identity: identity ?? undefined, admin }));
      }
      if (m === "PUT" || m === "POST") {
        const b = await readBody(req);
        const code = String(b.code || "").trim();
        const name = String(b.name || "").trim();
        const choices: string[] = Array.isArray(b.choices) ? b.choices.map(String) : [];
        if (!/^\d{9}$/.test(code)) return send(res, { error: "code must be 9 digits" }, 400);
        return send(res, await saveParticipant(code, name, choices, { identity: identity ?? undefined, admin }));
      }
    }

    if (p === "/api/wards" && (m === "PUT" || m === "POST")) {
      if (!isAdminReq(req)) return send(res, { error: "admin only" }, 401);
      const b = await readBody(req);
      await replaceWards(validateWards(b.wards));
      return send(res, { ok: true });
    }
    if (p === "/api/ward-templates") {
      if (!isAdminReq(req)) return send(res, { error: "admin only" }, 401);
      if (m === "GET") {
        return send(res, await listWardTemplates(), 200, { "cache-control": "private, no-store" });
      }
      if (m === "PUT" || m === "POST") {
        const b = await readBody(req);
        await saveWardTemplate(validateTemplate(b));
        return send(res, { ok: true });
      }
      if (m === "DELETE") {
        const id = url.searchParams.get("id") || "";
        if (!id) return send(res, { error: "id required" }, 400);
        await deleteWardTemplate(id);
        return send(res, { ok: true });
      }
    }
    if (p === "/api/settings" && (m === "PUT" || m === "POST")) {
      if (!isAdminReq(req)) return send(res, { error: "admin only" }, 401);
      const b = await readBody(req);
      if (typeof b.registrationOpen === "boolean") {
        await setRegistrationOpen(b.registrationOpen);
        return send(res, { ok: true });
      }
      const { term, year, title } = validateSettings(b.term, b.year, b.title);
      await saveSettings(term, year, title);
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
