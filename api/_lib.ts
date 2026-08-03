import { neon } from "@neondatabase/serverless";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { jwtVerify, createRemoteJWKSet } from "jose";

export type Ward = { id: string; name: string; capacity: number; pos?: number };
// เทมเพลต = snapshot ชุดวอร์ดตั้งชื่อ (wards ไม่มี pos — ลำดับตาม array)
export type WardTemplate = { id: string; name: string; wards: Ward[] };
// offRoster/email เติมเฉพาะ payload admin (public state ถูก mask, ไม่มี PII)
export type Participant = {
  code: string;
  rid: string;
  name: string;
  choices: string[];
  offRoster?: boolean;
  email?: string | null;
};
export type Assignment = { code: string; rid?: string; wardId: string | null; rank: number | null };
export type Settings = { term: string; year: string; title: string };
export type RosterEntry = { code: string; name: string };
export type State = {
  wards: Ward[];
  participants: Participant[];
  assignments: Assignment[] | null;
  runAt: string | null;
  settings: Settings;
  registrationOpen: boolean;
};

type Row = Record<string, any>;

/* ============ auth helpers ============ */

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const NAME_MAX = 100;
const MAX_CHOICES = 50;
const MAX_WARDS = 100;
const WARD_NAME_MAX = 100;
const WARD_ID_RE = /^[a-z0-9]{1,40}$/;
const MAX_CAPACITY = 1000;
const MAX_TEMPLATES = 50;
const TEMPLATE_NAME_MAX = 100;
const SETTING_MAX = 8;
const TITLE_MAX = 200;
export const MAX_BODY_BYTES = 64 * 1024;

/* ============ validation / masking helpers ============ */

function bad(msg: string): never {
  throw new HttpError(400, msg);
}

// public row id: opaque, ผูกกับ secret ทำให้ reverse จากรหัส นศ. ไม่ได้ (กัน brute-force 9 หลัก)
const ROW_ID_SECRET = () =>
  process.env.ROW_ID_SALT || process.env.ADMIN_KEY || "votenurse-fallback-salt";
export function rowId(code: string): string {
  return createHash("sha256").update(`${ROW_ID_SECRET()}:${code}`).digest("hex").slice(0, 12);
}
// mask รหัส นศ. เหลือ 3 หลักท้าย (เช่น ••••••789) สำหรับ payload public
export function maskCode(code: string): string {
  return code.length <= 3 ? code : "•".repeat(code.length - 3) + code.slice(-3);
}

// choices = ลำดับ ward id; ตัด falsy/ซ้ำ, cap ความยาว, validate รูปแบบ id
export function validateChoices(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > MAX_CHOICES) bad("too many choices");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    const s = String(c);
    if (!s) continue;
    if (!WARD_ID_RE.test(s)) bad("invalid ward id");
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// validate + normalize รายการวอร์ดจาก client ก่อนเขียน DB
export function validateWards(raw: unknown): Ward[] {
  if (!Array.isArray(raw)) bad("wards must be an array");
  if ((raw as unknown[]).length > MAX_WARDS) bad("too many wards");
  return (raw as any[]).map((w) => {
    const id = String(w?.id ?? "");
    if (!WARD_ID_RE.test(id)) bad("invalid ward id");
    const name = String(w?.name ?? "").trim().slice(0, WARD_NAME_MAX);
    if (!name) bad("ward name required");
    const capacity = Number(w?.capacity);
    if (!Number.isInteger(capacity) || capacity < 0 || capacity > MAX_CAPACITY) {
      bad("invalid capacity");
    }
    return { id, name, capacity };
  });
}

// validate + normalize เทมเพลตจาก client (id required, name, wards ผ่าน validateWards)
export function validateTemplate(raw: unknown): WardTemplate {
  const id = String((raw as any)?.id ?? "");
  if (!WARD_ID_RE.test(id)) bad("invalid template id");
  const name = String((raw as any)?.name ?? "").trim().slice(0, TEMPLATE_NAME_MAX);
  if (!name) bad("template name required");
  return { id, name, wards: validateWards((raw as any)?.wards) };
}

// validate term/year/title (คืน trimmed + cap ความยาว) — โยน 400 ถ้าว่าง
export function validateSettings(
  rawTerm: unknown,
  rawYear: unknown,
  rawTitle: unknown,
): { term: string; year: string; title: string } {
  const term = String(rawTerm ?? "").trim().slice(0, SETTING_MAX);
  const year = String(rawYear ?? "").trim().slice(0, SETTING_MAX);
  const title = String(rawTitle ?? "").trim().slice(0, TITLE_MAX);
  if (!term || !year) bad("term and year required");
  if (!title) bad("title required");
  return { term, year, title };
}

function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

type ReqLike = { headers?: Record<string, string | string[] | undefined> };

export function isAdminReq(req: ReqLike): boolean {
  const k = process.env.ADMIN_KEY;
  if (!k) return false;
  const sent = req.headers?.["x-admin-key"];
  if (!sent) return false;
  return safeEqual(k, Array.isArray(sent) ? sent[0] : sent);
}

/* ============ Google Identity (ownership proof ทางเดียว) ============ */

export type Identity = { sub: string; email: string | null };

// JWKS cache ใน memory ต่อ instance — verify ไม่ยิง network หลัง warm (สำคัญตอน 500 concurrent)
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function bearer(req: ReqLike): string | undefined {
  const h = req.headers?.["authorization"] ?? req.headers?.["Authorization"];
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(v);
  return m ? m[1] : undefined;
}

// verify Google ID token (JWT) กับ JWKS ของ Google; คืน Identity หรือ null ถ้าไม่มี token
// โยน 401 ถ้า token มีแต่ verify ไม่ผ่าน (หมดอายุ/ปลอม/ผิด audience)
export async function verifyIdentity(req: ReqLike): Promise<Identity | null> {
  const token = bearer(req);
  if (!token) return null;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new HttpError(500, "GOOGLE_CLIENT_ID not set");
  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    if (!payload.sub) throw new HttpError(401, "invalid token");
    const email = typeof payload.email === "string" ? payload.email : null;
    return { sub: payload.sub, email };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, "เข้าสู่ระบบใหม่อีกครั้ง");
  }
}

// บังคับต้อง login (ใช้กับ endpoint ที่ต้องมีตัวตน)
export async function requireIdentity(req: ReqLike): Promise<Identity> {
  const id = await verifyIdentity(req);
  if (!id) throw new HttpError(401, "ต้องเข้าสู่ระบบด้วย Google ก่อน");
  return id;
}

export function fail(res: VercelResponse, e: any) {
  const status = e?.status || 500;
  const msg = status >= 500 ? "server error" : e?.message || "error";
  return json(res, { error: msg }, status);
}

export const DEFAULT_TITLE =
  "ลงทะเบียนการฝึกปฏิบัติผู้นำทีมการพยาบาล และการฝึกปฏิบัติเพื่อเตรียมเข้าสู่วิชาชีพ";
const DEFAULT_SETTINGS: Settings = { term: "2", year: "2569", title: DEFAULT_TITLE };

export async function saveSettings(term: string, year: string, title: string) {
  const sql = db();
  await sql`INSERT INTO settings (key, value) VALUES ('term', ${term})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  await sql`INSERT INTO settings (key, value) VALUES ('year', ${year})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  await sql`INSERT INTO settings (key, value) VALUES ('title', ${title})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

// Registration Window: true = participant สร้าง/แก้ตัวเองได้, false = แช่แข็ง (admin bypass เสมอ)
export async function setRegistrationOpen(open: boolean) {
  const sql = db();
  await sql`INSERT INTO settings (key, value) VALUES ('registration_open', ${open ? "true" : "false"})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

async function isRegistrationOpen(sql: ReturnType<typeof db>): Promise<boolean> {
  const rows = (await sql`SELECT value FROM settings WHERE key = 'registration_open'`) as Row[];
  // default เปิด ถ้ายังไม่เคยตั้ง
  return rows.length ? rows[0].value !== "false" : true;
}

const DEFAULT_WARDS: Ward[] = [
  { id: "w1", name: "วอร์ด 1", capacity: 5, pos: 1 },
  { id: "w2", name: "วอร์ด 2", capacity: 5, pos: 2 },
  { id: "w3", name: "วอร์ด 3", capacity: 5, pos: 3 },
  { id: "w4", name: "วอร์ด 4", capacity: 5, pos: 4 },
  { id: "w5", name: "วอร์ด 5", capacity: 5, pos: 5 },
  { id: "w6", name: "วอร์ด 6", capacity: 5, pos: 6 },
];

export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  return neon(process.env.DATABASE_URL);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const parseJson = <T>(v: unknown, fallback: T): T =>
  v == null ? fallback : typeof v === "string" ? (JSON.parse(v) as T) : (v as T);

export async function getState(opts: { admin: boolean } = { admin: false }): Promise<State> {
  const sql = db();
  const pubCode = (code: string) => (opts.admin ? code : maskCode(code));

  // ทั้ง state ใน 1 HTTP round-trip เดียวไป Neon (เดิม 6 query) — สำคัญตอน concurrent สูง
  const rows = (await sql`
    SELECT
      (SELECT coalesce(json_agg(json_build_object('id',id,'name',name,'capacity',capacity,'pos',pos) ORDER BY pos, id), '[]'::json)
         FROM wards) AS wards,
      (SELECT coalesce(json_agg(json_build_object(
                'code',p.code,'name',p.name,'email',p.email,
                'off_roster',NOT EXISTS (SELECT 1 FROM roster ro WHERE ro.code = p.code)
              ) ORDER BY p.created_at, p.code), '[]'::json)
         FROM participants p) AS participants,
      (SELECT coalesce(json_agg(json_build_object('participant_code',participant_code,'ward_id',ward_id,'rank',rank) ORDER BY participant_code, rank), '[]'::json)
         FROM choices) AS choices,
      (SELECT row_to_json(r) FROM (SELECT id, created_at FROM runs ORDER BY id DESC LIMIT 1) r) AS latest_run,
      (SELECT coalesce(json_agg(json_build_object('participant_code',participant_code,'ward_id',ward_id,'rank',rank)), '[]'::json)
         FROM assignments WHERE run_id = (SELECT max(id) FROM runs)) AS assignments,
      (SELECT coalesce(json_object_agg(key, value), '{}'::json) FROM settings) AS settings
  `) as Row[];
  const r = rows[0] ?? {};

  const wards = parseJson<any[]>(r.wards, []);
  const participants = parseJson<any[]>(r.participants, []);
  const choices = parseJson<any[]>(r.choices, []);
  const latestRun = parseJson<any>(r.latest_run, null);
  const asg = parseJson<any[]>(r.assignments, []);
  const settingsMap = parseJson<Record<string, string>>(r.settings, {});

  const settings: Settings = {
    term: settingsMap.term ?? DEFAULT_SETTINGS.term,
    year: settingsMap.year ?? DEFAULT_SETTINGS.year,
    title: settingsMap.title ?? DEFAULT_SETTINGS.title,
  };
  const registrationOpen = settingsMap.registration_open !== "false";

  const choiceMap = new Map<string, string[]>();
  for (const c of choices) {
    if (!choiceMap.has(c.participant_code)) choiceMap.set(c.participant_code, []);
    choiceMap.get(c.participant_code)!.push(c.ward_id);
  }

  let assignments: Assignment[] | null = null;
  let runAt: string | null = null;
  if (latestRun) {
    assignments = asg.map((a) => ({
      code: pubCode(a.participant_code),
      rid: rowId(a.participant_code),
      wardId: a.ward_id,
      rank: a.rank,
    }));
    runAt = latestRun.created_at;
  }

  return {
    wards: wards.map((w) => ({ id: w.id, name: w.name, capacity: w.capacity, pos: w.pos })),
    participants: participants.map((p) => ({
      code: pubCode(p.code),
      rid: rowId(p.code),
      name: p.name,
      choices: choiceMap.get(p.code) ?? [],
      // email/offRoster เฉพาะ admin — public state ห้ามรั่ว PII/roster status
      ...(opts.admin ? { email: p.email ?? null, offRoster: !!p.off_roster } : {}),
    })),
    assignments,
    runAt,
    settings,
    registrationOpen,
  };
}

// multi-row INSERT ใน statement เดียว (ลด HTTP round-trips ไป Neon)
async function bulkInsert(
  sql: ReturnType<typeof db>,
  table: string,
  cols: string[],
  rows: any[][],
  onConflict = "",
) {
  if (!rows.length) return;
  const per = cols.length;
  const values = rows.map((_, i) => `(${Array.from({ length: per }, (_, k) => `$${i * per + k + 1}`).join(",")})`).join(",");
  const text = `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}${onConflict}`;
  await sql.query(text, rows.flat());
}

// เขียน choices ใหม่ทั้งหมดของคนหนึ่ง (ล้างเดิม + insert ใหม่)
async function applyChoices(
  sql: ReturnType<typeof db>,
  code: string,
  choices: string[],
) {
  await sql`DELETE FROM choices WHERE participant_code = ${code}`;
  const rows: any[][] = [];
  for (let i = 0; i < choices.length; i++) {
    if (choices[i]) rows.push([code, i + 1, choices[i]]);
  }
  await bulkInsert(sql, "choices", ["participant_code", "rank", "ward_id"], rows);
}

export async function saveParticipant(
  code: string,
  name: string,
  choices: string[],
  opts: { identity?: Identity; admin: boolean },
): Promise<{ ok: true; rid: string; code: string; name: string; choices: string[]; offRoster: boolean }> {
  const sql = db();
  const safeChoices = validateChoices(choices);
  const existing = (await sql`SELECT google_sub FROM participants WHERE code = ${code}`) as Row[];

  // roster เป็น source of truth ของชื่อ: อยู่ใน roster → ใช้ชื่อ roster, นอก roster → ใช้ชื่อที่กรอก
  const rosterRow = (await sql`SELECT name FROM roster WHERE code = ${code}`) as Row[];
  const inRoster = rosterRow.length > 0;
  const finalName = (inRoster ? String(rosterRow[0].name) : name).slice(0, NAME_MAX);
  if (!finalName.trim()) throw new HttpError(400, "name required");

  if (existing.length) {
    // แก้ข้อมูลเดิม: ต้องเป็นเจ้าของ (google_sub ตรง) หรือ admin
    const ownedByMe = !!opts.identity && existing[0].google_sub === opts.identity.sub;
    if (!opts.admin && !ownedByMe) {
      // รหัสถูกจองโดยบัญชีอื่น — ข้อความแบบ 12(C) ให้ผู้ใช้ลองสลับบัญชี
      throw new HttpError(
        409,
        "รหัสนี้ลงทะเบียนไว้แล้ว ถ้าเป็นคุณ ลองเข้าสู่ระบบด้วยบัญชี Google อื่นที่เคยใช้",
      );
    }
    if (!opts.admin && !(await isRegistrationOpen(sql))) {
      throw new HttpError(403, "ปิดรับสมัคร/แก้ไขแล้ว");
    }
    await sql`UPDATE participants SET name = ${finalName} WHERE code = ${code}`;
    await applyChoices(sql, code, safeChoices);
    return { ok: true, rid: rowId(code), code, name: finalName, choices: safeChoices, offRoster: !inRoster };
  }

  // สมัครใหม่
  if (!opts.admin) {
    if (!opts.identity) throw new HttpError(401, "ต้องเข้าสู่ระบบด้วย Google ก่อน");
    if (!(await isRegistrationOpen(sql))) throw new HttpError(403, "ปิดรับสมัครแล้ว");
    // 1 บัญชี = 1 รหัส: บัญชีนี้จองรหัสอื่นไว้แล้วหรือยัง
    const owned = (await sql`SELECT code FROM participants WHERE google_sub = ${opts.identity.sub}`) as Row[];
    if (owned.length) {
      throw new HttpError(409, `บัญชี Google นี้ลงทะเบียนรหัส ${owned[0].code} ไว้แล้ว`);
    }
  }
  const sub = opts.identity?.sub ?? null;   // admin สร้างแทน → NULL (admin เป็นเจ้าของ)
  const email = opts.identity?.email ?? null;
  await sql`INSERT INTO participants (code, name, google_sub, email)
            VALUES (${code}, ${finalName}, ${sub}, ${email})`;
  await applyChoices(sql, code, safeChoices);
  return { ok: true, rid: rowId(code), code, name: finalName, choices: safeChoices, offRoster: !inRoster };
}

// participant ที่ Identity นี้เป็นเจ้าของ (คืนรหัสเต็ม — ผู้ใช้ดูของตัวเองได้)
export async function getMe(
  identity: Identity,
): Promise<{ registered: boolean; code?: string; rid?: string; name?: string; choices?: string[]; offRoster?: boolean }> {
  const sql = db();
  const rows = (await sql`SELECT code, name FROM participants WHERE google_sub = ${identity.sub}`) as Row[];
  if (!rows.length) return { registered: false };
  const code = rows[0].code as string;
  const ch = (await sql`SELECT ward_id FROM choices WHERE participant_code = ${code} ORDER BY rank`) as Row[];
  const inRoster = ((await sql`SELECT 1 FROM roster WHERE code = ${code}`) as Row[]).length > 0;
  return {
    registered: true,
    code,
    rid: rowId(code),
    name: rows[0].name,
    choices: ch.map((c) => c.ward_id),
    offRoster: !inRoster,
  };
}

export async function removeParticipant(
  code: string,
  opts: { identity?: Identity; admin: boolean },
): Promise<{ ok: true }> {
  const sql = db();
  const existing = (await sql`SELECT google_sub FROM participants WHERE code = ${code}`) as Row[];
  if (!existing.length) return { ok: true };
  const ownedByMe = !!opts.identity && existing[0].google_sub === opts.identity.sub;
  if (!opts.admin && !ownedByMe) throw new HttpError(403, "ไม่ใช่เจ้าของข้อมูล");
  if (!opts.admin && !(await isRegistrationOpen(sql))) throw new HttpError(403, "ปิดรับสมัคร/แก้ไขแล้ว");
  await sql`DELETE FROM participants WHERE code = ${code}`;
  return { ok: true };
}

/* ============ Roster (soft allowlist — flag ไม่บล็อก) ============ */

// parse ข้อความที่ paste จาก Excel: ต่อบรรทัด = "code<tab|comma|ช่องว่าง>name"
// คืน { entries, skipped } — skipped = จำนวนแถวที่รูปแบบไม่ถูก (ให้ admin เห็นก่อนยืนยัน)
export function parseRoster(text: string): { entries: RosterEntry[]; skipped: number } {
  const entries: RosterEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{9})[\s,]+(.+)$/.exec(line);
    if (!m) {
      skipped++;
      continue;
    }
    const code = m[1];
    const name = m[2].trim().slice(0, NAME_MAX);
    if (!name || seen.has(code)) {
      skipped++;
      continue;
    }
    seen.add(code);
    entries.push({ code, name });
  }
  return { entries, skipped };
}

export function validateRoster(raw: unknown): RosterEntry[] {
  if (!Array.isArray(raw)) bad("roster must be an array");
  if (raw.length > 5000) bad("roster too large");
  const out: RosterEntry[] = [];
  const seen = new Set<string>();
  for (const e of raw as any[]) {
    const code = String(e?.code ?? "").trim();
    const name = String(e?.name ?? "").trim().slice(0, NAME_MAX);
    if (!/^\d{9}$/.test(code)) bad("invalid roster code");
    if (!name) bad("roster name required");
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name });
  }
  return out;
}

// แทนที่ roster ทั้งชุด (replace-all) — ไม่แตะ participants เด็ดขาด
export async function replaceRoster(entries: RosterEntry[]) {
  const sql = db();
  await sql`DELETE FROM roster`;
  await bulkInsert(sql, "roster", ["code", "name"], entries.map((e) => [e.code, e.name]));
}

export async function getRoster(): Promise<RosterEntry[]> {
  const sql = db();
  const rows = (await sql`SELECT code, name FROM roster ORDER BY code`) as Row[];
  return rows.map((r) => ({ code: r.code, name: r.name }));
}

// name auto-fill: คืนชื่อจาก roster ตามรหัส (ไม่บอกสถานะลงทะเบียน = ไม่เป็น oracle ให้ squatter)
export async function rosterName(code: string): Promise<{ found: boolean; name?: string }> {
  const sql = db();
  const rows = (await sql`SELECT name FROM roster WHERE code = ${code}`) as Row[];
  return rows.length ? { found: true, name: rows[0].name } : { found: false };
}

export async function replaceWards(wards: Ward[]) {
  const sql = db();
  const provided = wards.map((w) => w.id);
  const existing = (await sql`SELECT id FROM wards`) as Row[];
  const toDelete = existing.map((r) => r.id).filter((id: string) => !provided.includes(id));

  await bulkInsert(
    sql,
    "wards",
    ["id", "name", "capacity", "pos"],
    wards.map((w, i) => [w.id, w.name, w.capacity, i]),
    " ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, capacity = EXCLUDED.capacity, pos = EXCLUDED.pos",
  );
  // ลบวอร์ดที่ถูกลบออก ทีละอัน (cascade choices ฝั่ง DB)
  for (const id of toDelete) {
    await sql`DELETE FROM wards WHERE id = ${id}`;
  }
  // เปลี่ยนชุดวอร์ด = อันดับเดิมของผู้ใช้ใช้ไม่ได้แล้ว → ล้าง choices ทั้งหมด ให้ทุกคนจัดอันดับใหม่
  await sql`DELETE FROM choices`;
}

/* ============ Ward Templates (preset ชุดวอร์ดของ admin) ============ */

// list เทมเพลตทั้งหมด (เรียงใหม่สุดก่อน)
export async function listWardTemplates(): Promise<WardTemplate[]> {
  const sql = db();
  const rows = (await sql`SELECT id, name, wards FROM ward_templates ORDER BY created_at DESC`) as Row[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    // wards เก็บเป็น jsonb → neon คืนเป็น array อยู่แล้ว; normalize ปลอดภัยหน่อย
    wards: parseJson<any[]>(r.wards, []).map((w: any) => ({
      id: String(w.id),
      name: String(w.name),
      capacity: Number(w.capacity),
    })),
  }));
}

// upsert เทมเพลต (id ซ้ำ = update); insert ใหม่ต้องไม่เกิน MAX_TEMPLATES
export async function saveWardTemplate(t: WardTemplate) {
  const sql = db();
  const existing = (await sql`SELECT 1 FROM ward_templates WHERE id = ${t.id}`) as Row[];
  if (!existing.length) {
    const n = ((await sql`SELECT count(*)::int AS c FROM ward_templates`) as Row[])[0]?.c ?? 0;
    if (n >= MAX_TEMPLATES) bad("too many templates");
  }
  // strip pos ออกจาก wards ตอนเก็บ (ลำดับดูจาก array)
  const wards = t.wards.map(({ id, name, capacity }) => ({ id, name, capacity }));
  await sql`
    INSERT INTO ward_templates (id, name, wards)
    VALUES (${t.id}, ${t.name}, ${JSON.stringify(wards)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, wards = EXCLUDED.wards
  `;
}

export async function deleteWardTemplate(id: string) {
  const sql = db();
  await sql`DELETE FROM ward_templates WHERE id = ${id}`;
}

export async function runAdmission(): Promise<{ assignments: Assignment[]; runAt: string }> {
  const sql = db();
  const [wards, participants, choices] = (await Promise.all([
    sql`SELECT id, capacity FROM wards`,
    sql`SELECT code FROM participants`,
    sql`SELECT participant_code, ward_id, rank FROM choices`,
  ])) as [Row[], Row[], Row[]];

  const cap = new Map<string, number>(wards.map((w) => [w.id, w.capacity]));
  const choiceByCode = new Map<string, Map<number, string>>();
  for (const c of choices) {
    if (!choiceByCode.has(c.participant_code)) choiceByCode.set(c.participant_code, new Map());
    choiceByCode.get(c.participant_code)!.set(c.rank, c.ward_id);
  }
  const people = participants.map((p) => ({
    code: p.code,
    choices: [...(choiceByCode.get(p.code) ?? new Map()).entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, wid]) => wid),
  }));

  const order = shuffle(people);
  const remaining = new Map(cap);
  const result: Assignment[] = [];
  for (const p of order) {
    let placed = false;
    for (let i = 0; i < p.choices.length; i++) {
      const wid = p.choices[i];
      if (wid && (remaining.get(wid) ?? 0) > 0) {
        remaining.set(wid, remaining.get(wid)! - 1);
        result.push({ code: p.code, wardId: wid, rank: i + 1 });
        placed = true;
        break;
      }
    }
    if (!placed) result.push({ code: p.code, wardId: null, rank: null });
  }

  const run = (await sql`INSERT INTO runs DEFAULT VALUES RETURNING id, created_at`) as Row[];
  const rid = run[0].id;
  const runAt = run[0].created_at as string;

  await bulkInsert(
    sql,
    "assignments",
    ["run_id", "participant_code", "ward_id", "rank"],
    result.map((a) => [rid, a.code, a.wardId, a.rank]),
  );

  return { assignments: result, runAt };
}

export type RunItem = { code: string; name: string; wardId: string | null; wardName: string; rank: number | null };
export type RunSummary = {
  id: number;
  runAt: string;
  total: number;
  stats: { r1: number; r2: number; rother: number; rnone: number };
  items: RunItem[];
};

export async function getRunsHistory(): Promise<RunSummary[]> {
  const sql = db();
  const rows = (await sql`
    SELECT r.id AS run_id, r.created_at AS run_at,
           a.participant_code, a.ward_id, a.rank,
           p.name AS p_name, w.name AS w_name
    FROM runs r
    LEFT JOIN assignments a ON a.run_id = r.id
    LEFT JOIN participants p ON p.code = a.participant_code
    LEFT JOIN wards w ON w.id = a.ward_id
    ORDER BY r.id DESC, a.rank NULLS LAST, p.name
  `) as (Row & {
    run_id: number;
    run_at: string;
    participant_code: string | null;
    ward_id: string | null;
    rank: number | null;
    p_name: string | null;
    w_name: string | null;
  })[];

  const map = new Map<number, RunSummary>();
  for (const r of rows) {
    if (!map.has(r.run_id)) {
      map.set(r.run_id, {
        id: r.run_id,
        runAt: r.run_at,
        total: 0,
        stats: { r1: 0, r2: 0, rother: 0, rnone: 0 },
        items: [],
      });
    }
    if (r.participant_code) {
      const run = map.get(r.run_id)!;
      const item: RunItem = {
        code: r.participant_code,
        name: r.p_name ?? r.participant_code,
        wardId: r.ward_id,
        wardName: r.w_name ?? r.ward_id ?? "—",
        rank: r.rank,
      };
      run.items.push(item);
      run.total += 1;
      if (r.rank === 1) run.stats.r1 += 1;
      else if (r.rank === 2) run.stats.r2 += 1;
      else if (r.rank == null) run.stats.rnone += 1;
      else run.stats.rother += 1;
    }
  }
  return [...map.values()];
}

export async function resetAll() {
  const sql = db();
  // atomic: ลบ + seed ทั้งหมดใน transaction เดียว ถ้าสัก statement fail → rollback ไม่เหลือ state ครึ่งๆ กลางๆ
  await sql.transaction([
    sql`DELETE FROM assignments`,
    sql`DELETE FROM runs`,
    sql`DELETE FROM choices`,
    sql`DELETE FROM participants`,
    sql`DELETE FROM wards`,
    ...DEFAULT_WARDS.map((w, i) =>
      sql`INSERT INTO wards (id, name, capacity, pos) VALUES (${w.id}, ${w.name}, ${w.capacity}, ${i})`,
    ),
  ]);
}

// reset แบบแยกขอบเขต ตาม tab ของ admin. cascade ฝั่ง DB (FK ON DELETE) จัดการตารางที่ขึ้นต่อกัน:
//   participants → choices + assignments หาย / runs → assignments หาย / wards → choices หาย + assignments.ward_id NULL
export async function resetScope(scope: string) {
  const sql = db();
  switch (scope) {
    case "all":
      return resetAll();
    // ลบผู้ลงทะเบียนทั้งหมด → choices + assignments cascade ไปด้วย. runs ยังอยู่แต่ว่าง
    case "participants":
      return sql`DELETE FROM participants`;
    // ล้างผล + ประวัติการจัดสรร → assignments cascade ไปด้วย. เก็บ participants + choices ไว้
    case "runs":
      return sql`DELETE FROM runs`;
    // ล้างรายชื่อรุ่น (soft roster, ไม่ผูกอะไร) — participants ที่ขึ้น "นอกรายชื่อ" จะกลับเป็น off-roster ทั้งหมด
    case "roster":
      return sql`DELETE FROM roster`;
    // รีเซ็ตวอร์ดเป็น default w1–w6 → choices cascade, assignments.ward_id NULL
    case "wards": {
      await sql.transaction([
        sql`DELETE FROM wards`,
        ...DEFAULT_WARDS.map((w, i) =>
          sql`INSERT INTO wards (id, name, capacity, pos) VALUES (${w.id}, ${w.name}, ${w.capacity}, ${i})`,
        ),
      ]);
      return;
    }
    default:
      throw new Error("invalid reset scope");
  }
}

export function json(res: VercelResponse, data: unknown, status = 200) {
  return res.status(status).json(data);
}

export function readBody(req: VercelRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let s = "";
    let size = 0;
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // payload ใหญ่เกิน — หยุดสะสม + resolve เป็น {} (handler จะตอบ 400 เพราะ field ขาด)
        // ไม่ปิด socket เอง เพื่อให้ response 400 ส่งถึง client ได้
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
}
