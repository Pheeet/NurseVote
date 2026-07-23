import { neon } from "@neondatabase/serverless";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, randomBytes } from "node:crypto";

export type Ward = { id: string; name: string; capacity: number; pos?: number };
export type Participant = { code: string; name: string; choices: string[] };
export type Assignment = { code: string; wardId: string | null; rank: number | null };
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

async function getSettings(sql: ReturnType<typeof db>): Promise<Settings> {
  try {
    const rows = (await sql`SELECT key, value FROM settings`) as Row[];
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      term: map.get("term") ?? DEFAULT_SETTINGS.term,
      year: map.get("year") ?? DEFAULT_SETTINGS.year,
    };
  } catch {
    // ตาราง settings อาจยังไม่ถูก migrate — ใช้ค่าเริ่มต้นไปก่อน
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(term: string, year: string) {
  const sql = db();
  await sql.transaction([
    sql`INSERT INTO settings (key, value) VALUES ('term', ${term})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    sql`INSERT INTO settings (key, value) VALUES ('year', ${year})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  ]);
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

export async function getState(): Promise<State> {
  const sql = db();
  const [wards, participants, choices, latestRun, settings] = (await Promise.all([
    sql`SELECT id, name, capacity, pos FROM wards ORDER BY pos, id`,
    sql`SELECT code, name FROM participants ORDER BY created_at, code`,
    sql`SELECT participant_code, ward_id, rank FROM choices ORDER BY participant_code, rank`,
    sql`SELECT id, created_at FROM runs ORDER BY id DESC LIMIT 1`,
    getSettings(sql),
  ])) as [Row[], Row[], Row[], Row[], Settings];

  const choiceMap = new Map<string, string[]>();
  for (const c of choices) {
    if (!choiceMap.has(c.participant_code)) choiceMap.set(c.participant_code, []);
    choiceMap.get(c.participant_code)!.push(c.ward_id);
  }

  let assignments: Assignment[] | null = null;
  let runAt: string | null = null;
  if (latestRun.length) {
    const rows = (await sql`
      SELECT participant_code, ward_id, rank FROM assignments WHERE run_id = ${latestRun[0].id}
    `) as Row[];
    assignments = rows.map((r) => ({
      code: r.participant_code,
      wardId: r.ward_id,
      rank: r.rank,
    }));
    runAt = latestRun[0].created_at;
  }

  return {
    wards: wards.map((w) => ({ id: w.id, name: w.name, capacity: w.capacity, pos: w.pos })),
    participants: participants.map((p) => ({
      code: p.code,
      name: p.name,
      choices: choiceMap.get(p.code) ?? [],
    })),
    assignments,
    runAt,
    settings,
  };
}

function choiceQueries(
  sql: ReturnType<typeof db>,
  code: string,
  choices: string[],
): ReturnType<typeof sql>[] {
  const queries: ReturnType<typeof sql>[] = [
    sql`DELETE FROM choices WHERE participant_code = ${code}`,
  ];
  for (let i = 0; i < choices.length; i++) {
    const wid = choices[i];
    if (wid) {
      queries.push(
        sql`INSERT INTO choices (participant_code, rank, ward_id) VALUES (${code}, ${i + 1}, ${wid})`,
      );
    }
  }
  return queries;
}

export async function saveParticipant(
  code: string,
  name: string,
  choices: string[],
  opts: { token?: string; admin: boolean },
): Promise<{ ok: true; token?: string }> {
  const sql = db();
  const safeName = name.slice(0, NAME_MAX);
  const existing = (await sql`SELECT token FROM participants WHERE code = ${code}`) as Row[];

  if (existing.length) {
    const allowed =
      opts.admin ||
      (!!opts.token && !!existing[0].token && safeEqual(hashToken(opts.token), existing[0].token));
    if (!allowed) throw new HttpError(403, "ไม่ใช่เจ้าของข้อมูล");
    await sql.transaction([
      sql`UPDATE participants SET name = ${safeName} WHERE code = ${code}`,
      ...choiceQueries(sql, code, choices),
    ]);
    return { ok: true };
  }

  // สมัครใหม่: สร้าง ownership token ส่งกลับให้ client เก็บ
  const token = randomBytes(24).toString("hex");
  await sql.transaction([
    sql`INSERT INTO participants (code, name, token) VALUES (${code}, ${safeName}, ${hashToken(token)})`,
    ...choiceQueries(sql, code, choices),
  ]);
  return { ok: true, token };
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
  const queries: ReturnType<typeof sql>[] = [];
  for (let i = 0; i < wards.length; i++) {
    const w = wards[i];
    queries.push(
      sql`INSERT INTO wards (id, name, capacity, pos) VALUES (${w.id}, ${w.name}, ${w.capacity}, ${i})
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, capacity = EXCLUDED.capacity, pos = EXCLUDED.pos`,
    );
  }
  const ids = wards.map((w) => w.id);
  queries.push(ids.length ? sql`DELETE FROM wards WHERE id NOT IN (${ids})` : sql`DELETE FROM wards`);
  await sql.transaction(queries);
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

  const queries: ReturnType<typeof sql>[] = result.map((a) =>
    sql`INSERT INTO assignments (run_id, participant_code, ward_id, rank)
        VALUES (${rid}, ${a.code}, ${a.wardId}, ${a.rank})`,
  );
  if (queries.length) await sql.transaction(queries);

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
  const queries: ReturnType<typeof sql>[] = [
    sql`DELETE FROM assignments`,
    sql`DELETE FROM runs`,
    sql`DELETE FROM choices`,
    sql`DELETE FROM participants`,
    sql`DELETE FROM wards`,
    ...DEFAULT_WARDS.map((w, i) =>
      sql`INSERT INTO wards (id, name, capacity, pos) VALUES (${w.id}, ${w.name}, ${w.capacity}, ${i})`,
    ),
  ];
  await sql.transaction(queries);
}

export function json(res: VercelResponse, data: unknown, status = 200) {
  return res.status(status).json(data);
}

export function readBody(req: VercelRequest): Promise<any> {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve) => {
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
}
