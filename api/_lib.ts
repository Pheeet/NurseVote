import { neon } from "@neondatabase/serverless";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomBytes } from "node:crypto";

export type Ward = { id: string; name: string; capacity: number; pos?: number };
export type Participant = { code: string; rid: string; name: string; choices: string[] };
export type Assignment = { code: string; rid?: string; wardId: string | null; rank: number | null };
export type Settings = { term: string; year: string };
export type State = {
  wards: Ward[];
  participants: Participant[];
  assignments: Assignment[] | null;
  runAt: string | null;
  settings: Settings;
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
const SETTING_MAX = 8;
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

// validate term/year (คืน trimmed + cap ความยาว) — โยน 400 ถ้าว่าง
export function validateSettings(rawTerm: unknown, rawYear: unknown): { term: string; year: string } {
  const term = String(rawTerm ?? "").trim().slice(0, SETTING_MAX);
  const year = String(rawYear ?? "").trim().slice(0, SETTING_MAX);
  if (!term || !year) bad("term and year required");
  return { term, year };
}

function hashToken(t: string) {
  return createHash("sha256").update(t).digest("hex");
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

export function participantToken(req: ReqLike): string | undefined {
  const h = req.headers?.["x-participant-token"];
  if (!h) return undefined;
  return Array.isArray(h) ? h[0] : h;
}

export function fail(res: VercelResponse, e: any) {
  const status = e?.status || 500;
  const msg = status >= 500 ? "server error" : e?.message || "error";
  return json(res, { error: msg }, status);
}

const DEFAULT_SETTINGS: Settings = { term: "2", year: "2569" };

export async function saveSettings(term: string, year: string) {
  const sql = db();
  await sql`INSERT INTO settings (key, value) VALUES ('term', ${term})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  await sql`INSERT INTO settings (key, value) VALUES ('year', ${year})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
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
      (SELECT coalesce(json_agg(json_build_object('code',code,'name',name) ORDER BY created_at, code), '[]'::json)
         FROM participants) AS participants,
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
  };

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
    })),
    assignments,
    runAt,
    settings,
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
  opts: { token?: string; admin: boolean },
): Promise<{ ok: true; token?: string; rid: string }> {
  const sql = db();
  const safeName = name.slice(0, NAME_MAX);
  const safeChoices = validateChoices(choices);
  const existing = (await sql`SELECT token FROM participants WHERE code = ${code}`) as Row[];

  if (existing.length) {
    const allowed =
      opts.admin ||
      (!!opts.token && !!existing[0].token && safeEqual(hashToken(opts.token), existing[0].token));
    if (!allowed) throw new HttpError(403, "ไม่ใช่เจ้าของข้อมูล");
    await sql`UPDATE participants SET name = ${safeName} WHERE code = ${code}`;
    await applyChoices(sql, code, safeChoices);
    return { ok: true, rid: rowId(code) };
  }

  // สมัครใหม่: สร้าง ownership token ส่งกลับให้ client เก็บ
  const token = randomBytes(24).toString("hex");
  await sql`INSERT INTO participants (code, name, token) VALUES (${code}, ${safeName}, ${hashToken(token)})`;
  await applyChoices(sql, code, safeChoices);
  return { ok: true, token, rid: rowId(code) };
}

// เช็คว่ารหัสนี้มีในระบบไหม (ไม่คืน PII อื่น) + คืน rid ของรหัสที่ query มา
export async function participantExists(code: string): Promise<{ exists: boolean; rid: string }> {
  const sql = db();
  const rows = (await sql`SELECT 1 FROM participants WHERE code = ${code}`) as Row[];
  return { exists: rows.length > 0, rid: rowId(code) };
}

export async function removeParticipant(
  code: string,
  opts: { token?: string; admin: boolean },
): Promise<{ ok: true }> {
  const sql = db();
  const existing = (await sql`SELECT token FROM participants WHERE code = ${code}`) as Row[];
  if (!existing.length) return { ok: true };
  const allowed =
    opts.admin ||
    (!!opts.token && !!existing[0].token && safeEqual(hashToken(opts.token), existing[0].token));
  if (!allowed) throw new HttpError(403, "ไม่ใช่เจ้าของข้อมูล");
  await sql`DELETE FROM participants WHERE code = ${code}`;
  return { ok: true };
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
  await sql`DELETE FROM assignments`;
  await sql`DELETE FROM runs`;
  await sql`DELETE FROM choices`;
  await sql`DELETE FROM participants`;
  await sql`DELETE FROM wards`;
  for (let i = 0; i < DEFAULT_WARDS.length; i++) {
    const w = DEFAULT_WARDS[i];
    await sql`INSERT INTO wards (id, name, capacity, pos) VALUES (${w.id}, ${w.name}, ${w.capacity}, ${i})`;
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
