import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";

export const Route = createFileRoute("/")({
  component: Index,
});

type Ward = { id: string; name: string; capacity: number; pos?: number };
type Participant = { code: string; name: string; choices: string[] };
type Assignment = { code: string; wardId: string | null; rank: number | null };
type Settings = { term: string; year: string };
type RunItem = {
  code: string;
  name: string;
  wardId: string | null;
  wardName: string;
  rank: number | null;
};
type RunSummary = {
  id: number;
  runAt: string;
  total: number;
  stats: { r1: number; r2: number; rother: number; rnone: number };
  items: RunItem[];
};
type State = {
  wards: Ward[];
  participants: Participant[];
  assignments: Assignment[] | null;
  runAt: string | null;
  settings: Settings;
};

const ME_KEY = "nurse-cheer-me";
const ADMIN_PASSWORD = "admin2568";

/* ============ API ============ */

const json = (r: Response) => r.json();

const API = {
  getState: () => fetch("/api/state").then<State>(json),
  saveParticipant: (code: string, name: string, choices: string[]) =>
    fetch("/api/participant", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name, choices }),
    }).then(json),
  deleteParticipant: (code: string) =>
    fetch(`/api/participant?code=${encodeURIComponent(code)}`, { method: "DELETE" }).then(json),
  saveWards: (wards: Ward[]) =>
    fetch("/api/wards", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wards }),
    }).then(json),
  saveSettings: (term: string, year: string) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ term, year }),
    }).then(json),
  run: () => fetch("/api/run", { method: "POST" }).then<{ assignments: Assignment[]; runAt: string }>(json),
  runs: () => fetch("/api/run").then<RunSummary[]>(json),
  reset: () => fetch("/api/reset", { method: "POST" }).then(json),
};

const uid = () => Math.random().toString(36).slice(2, 10);

function Index() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminOk, setAdminOk] = useState(false);
  const [meCode, setMeCode] = useState<string>("");
  const taps = useRef(0);
  const tapTimer = useRef<number | null>(null);

  useEffect(() => {
    setMeCode(localStorage.getItem(ME_KEY) || "");
    refresh();
  }, []);

  const refresh = async () => {
    try {
      setError("");
      const s = await API.getState();
      setState(s);
    } catch (e: any) {
      setError(e.message || "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่");
    }
  };

  const runBusy = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try {
      const r = await fn();
      await refresh();
      return r;
    } catch (e: any) {
      setError(e.message || "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  };

  const onSaveParticipant = (code: string, name: string, choices: string[]) =>
    runBusy(() => API.saveParticipant(code, name, choices));
  const onDeleteParticipant = (code: string) => runBusy(() => API.deleteParticipant(code));
  const onSaveWards = (wards: Ward[]) => runBusy(() => API.saveWards(wards));
  const onRun = () => runBusy(() => API.run());
  const onReset = () => runBusy(() => API.reset());
  const onSaveSettings = (term: string, year: string) =>
    runBusy(() => API.saveSettings(term, year));

  const me = state?.participants.find((p) => p.code === meCode) ?? null;

  const secretAdmin = () => {
    taps.current += 1;
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => {
      taps.current = 0;
    }, 1200);
    if (taps.current >= 5) {
      taps.current = 0;
      setAdminMode(true);
    }
  };

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-16 pt-6">
      <header className="mb-6 text-center">
        <h1
          onClick={secretAdmin}
          className="select-none text-balance text-lg font-bold leading-snug tracking-tight"
        >
          ลงทะเบียนการฝึกปฏิบัติผู้นำทีมการพยาบาล และการฝึกปฏิบัติเพื่อเตรียมเข้าสู่วิชาชีพ
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">
          ประจำภาคการศึกษาที่ {state?.settings.term ?? "2"} ปีการศึกษา {state?.settings.year ?? "2569"}
        </p>
      </header>

      {!state ? (
        <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
          {error || "กำลังโหลด…"}
        </div>
      ) : (
        <UserView
          state={state}
          me={me}
          meCode={meCode}
          setMeCode={(v) => {
            setMeCode(v);
            localStorage.setItem(ME_KEY, v);
          }}
          onSaveParticipant={onSaveParticipant}
          onDeleteParticipant={onDeleteParticipant}
        />
      )}

      {error && state && (
        <p className="mt-3 text-center text-xs text-destructive">{error}</p>
      )}

      {adminMode && !adminOk && (
        <AdminLogin
          onOk={() => setAdminOk(true)}
          onClose={() => setAdminMode(false)}
        />
      )}
      {adminMode && adminOk && state && (
        <AdminView
          state={state}
          busy={busy}
          onExit={() => {
            setAdminOk(false);
            setAdminMode(false);
          }}
          onSaveWards={onSaveWards}
          onDeleteParticipant={onDeleteParticipant}
          onRun={onRun}
          onReset={onReset}
          onSaveSettings={onSaveSettings}
        />
      )}
    </div>
  );
}

/* ============ USER ============ */

function UserView({
  state,
  me,
  meCode,
  setMeCode,
  onSaveParticipant,
  onDeleteParticipant,
}: {
  state: State;
  me: Participant | null;
  meCode: string;
  setMeCode: (v: string) => void;
  onSaveParticipant: (code: string, name: string, choices: string[]) => Promise<unknown>;
  onDeleteParticipant: (code: string) => Promise<unknown>;
}) {
  const [tab, setTab] = useState<"me" | "list" | "wards" | "results">("me");

  return (
    <>
      <LayoutGroup id="user-tabs">
        <nav className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-card p-1 shadow-[var(--shadow-soft)]">
          {[
            { k: "me", label: me ? "ข้อมูลของฉัน" : "ลงทะเบียน" },
            { k: "list", label: `รายชื่อ (${state.participants.length})` },
            { k: "wards", label: "หวอด" },
            { k: "results", label: "ผลการจัดสรร" },
          ].map((t) => {
            const active = tab === t.k;
            return (
              <button
                key={t.k}
                onClick={() => setTab(t.k as typeof tab)}
                className={`relative rounded-xl px-1 py-2 text-[11px] font-semibold ${
                  active ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="user-tab-pill"
                    className="absolute inset-0 rounded-xl bg-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </nav>
      </LayoutGroup>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {tab === "me" && (
            <MePanel
              state={state}
              me={me}
              setMeCode={setMeCode}
              onSaveParticipant={onSaveParticipant}
              onDeleteParticipant={() => (me ? onDeleteParticipant(me.code) : Promise.resolve())}
            />
          )}
          {tab === "list" && (
            <ListPanel
              state={state}
              meCode={meCode}
              isAdmin={false}
              onDeleteParticipant={onDeleteParticipant}
            />
          )}
          {tab === "wards" && <WardsReadonly wards={state.wards} participants={state.participants} />}
          {tab === "results" && <ResultsPanel state={state} />}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

function MePanel({
  state,
  me,
  setMeCode,
  onSaveParticipant,
  onDeleteParticipant,
}: {
  state: State;
  me: Participant | null;
  setMeCode: (v: string) => void;
  onSaveParticipant: (code: string, name: string, choices: string[]) => Promise<unknown>;
  onDeleteParticipant: () => Promise<unknown>;
}) {
  const wards = state.wards;
  const N = wards.length;

  const [name, setName] = useState(me?.name ?? "");
  const [code, setCode] = useState(me?.code ?? "");
  const [choices, setChoices] = useState<string[]>(
    me?.choices?.length
      ? [...me.choices, ...Array(Math.max(0, N - me.choices.length)).fill("")].slice(0, N)
      : Array(N).fill(""),
  );
  const [err, setErr] = useState("");

  useEffect(() => {
    if (me) {
      setName(me.name);
      setCode(me.code);
      setChoices([...me.choices, ...Array(Math.max(0, N - me.choices.length)).fill("")].slice(0, N));
    }
  }, [me, N]);

  const usedBefore = (idx: number) => new Set(choices.slice(0, idx).filter(Boolean));
  const validCode = /^\d{9}$/.test(code);
  const dupCode = !me && state.participants.some((p) => p.code === code);
  const editDupCode = !!me && state.participants.some((p) => p.code === code && p.code !== me.code);
  const canSubmit = !!name.trim() && validCode && !dupCode && !editDupCode && choices.every((c) => c);

  const submit = async () => {
    setErr("");
    if (!name.trim()) return setErr("กรุณากรอกชื่อ–นามสกุล");
    if (!validCode) return setErr("รหัสนักศึกษาต้องเป็นตัวเลข 9 หลัก");
    if (dupCode || editDupCode) return setErr("รหัสนักศึกษานี้ลงทะเบียนไว้แล้ว");
    if (!choices.every((c) => c)) return setErr("กรุณาจัดอันดับหวอดให้ครบทุกอันดับ");

    await onSaveParticipant(code, name.trim(), choices);
    setMeCode(code);
  };

  const deleteMe = async () => {
    if (!me) return;
    if (!confirm("ยกเลิกการลงทะเบียนของคุณ? ข้อมูลที่กรอกไว้จะถูกลบ")) return;
    await onDeleteParticipant();
    setMeCode("");
    setName("");
    setCode("");
    setChoices(Array(N).fill(""));
  };

  return (
    <div className="space-y-4">
      {!me && (
        <ExistingLoginBox participants={state.participants} onLogin={(c) => setMeCode(c)} />
      )}

      <div className="rounded-3xl bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">{me ? "แก้ไขข้อมูลการลงทะเบียน" : "ลงทะเบียน"}</div>
          {me && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              ลงทะเบียนแล้ว
            </span>
          )}
        </div>

        <label className="text-xs font-medium text-muted-foreground">ชื่อ</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ชื่อ–นามสกุล"
          className="mt-1 w-full rounded-xl bg-muted px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary/40"
        />

        <label className="mt-3 block text-xs font-medium text-muted-foreground">
          รหัสนักศึกษา 9 หลัก
        </label>
        <input
          value={code}
          inputMode="numeric"
          maxLength={9}
          disabled={!!me}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 9))}
          placeholder="เช่น 123456789"
          className="mt-1 w-full rounded-xl bg-muted px-3 py-2.5 text-base tracking-widest outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        />
        {code && !validCode && <p className="mt-1 text-[11px] text-destructive">รหัสนักศึกษาต้องเป็นตัวเลข 9 หลัก</p>}
        {(dupCode || editDupCode) && <p className="mt-1 text-[11px] text-destructive">รหัสนักศึกษานี้ลงทะเบียนไว้แล้ว</p>}

        <div className="mt-4 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">จัดอันดับหวอดทั้งหมด {N} อันดับ</div>
          {choices.map((val, i) => {
            const used = usedBefore(i);
            return (
              <div key={i} className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <select
                  value={val}
                  onChange={(e) => {
                    const next = [...choices];
                    next[i] = e.target.value;
                    setChoices(next);
                  }}
                  className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">— เลือกหวอด —</option>
                  {wards.map((w) => (
                    <option key={w.id} value={w.id} disabled={used.has(w.id) && val !== w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {err && <p className="mt-3 text-xs text-destructive">{err}</p>}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-4 w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow transition disabled:opacity-40"
        >
          {me ? "บันทึกการเปลี่ยนแปลง" : "ลงทะเบียน"}
        </button>

        {me && (
          <button
            onClick={deleteMe}
            className="mt-2 w-full rounded-2xl bg-destructive/10 py-2.5 text-xs font-semibold text-destructive"
          >
            ยกเลิกการลงทะเบียน
          </button>
        )}
      </div>
    </div>
  );
}

function ExistingLoginBox({
  participants,
  onLogin,
}: {
  participants: Participant[];
  onLogin: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const login = () => {
    const p = participants.find((x) => x.code === code);
    if (!p) return setErr("ไม่พบรหัสนักศึกษานี้ในระบบ");
    onLogin(code);
  };
  return (
    <div className="rounded-2xl bg-accent/30 p-3">
      <div className="text-xs font-semibold text-accent-foreground">เคยลงทะเบียนไว้แล้ว?</div>
      <div className="mt-2 flex gap-2">
        <input
          value={code}
          inputMode="numeric"
          maxLength={9}
          placeholder="กรอกรหัสนักศึกษาเพื่อดึงข้อมูลเดิม"
          onChange={(e) => {
            setErr("");
            setCode(e.target.value.replace(/\D/g, "").slice(0, 9));
          }}
          className="min-w-0 flex-1 rounded-xl bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          onClick={login}
          className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
        >
          ดึงข้อมูล
        </button>
      </div>
      {err && <p className="mt-1 text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

/* ============ SHARED LIST ============ */

function ListPanel({
  state,
  meCode,
  isAdmin,
  onDeleteParticipant,
}: {
  state: State;
  meCode: string;
  isAdmin: boolean;
  onDeleteParticipant: (code: string) => Promise<unknown>;
}) {
  const [q, setQ] = useState("");
  const filtered = state.participants.filter((p) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return p.name.toLowerCase().includes(s) || p.code.includes(s);
  });

  const remove = async (code: string) => {
    if (!confirm("ลบรายชื่อนี้ออกจากระบบ?")) return;
    await onDeleteParticipant(code);
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาชื่อหรือรหัสนักศึกษา"
          className="w-full rounded-2xl bg-card py-3 pl-11 pr-4 text-sm shadow-[var(--shadow-soft)] outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-card p-6 text-center text-xs text-muted-foreground shadow-[var(--shadow-soft)]">
          {q.trim() ? "ไม่พบรายชื่อที่ค้นหา" : "ยังไม่มีผู้ลงทะเบียน"}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const canDelete = isAdmin || p.code === meCode;
            return (
              <div key={p.code} className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-[var(--shadow-soft)]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                    {p.code === meCode && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                        ฉัน
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">รหัส {p.code}</div>
                </div>
                {canDelete && (
                  <button
                    onClick={() => remove(p.code)}
                    className="rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  >
                    ลบ
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============ WARDS ============ */

function WardsReadonly({ wards, participants }: { wards: Ward[]; participants: Participant[] }) {
  const total = wards.reduce((s, w) => s + w.capacity, 0);
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-accent/30 p-3 text-center text-xs text-accent-foreground">
        รับได้รวม <b>{total}</b> คน · ลงทะเบียนแล้ว <b>{participants.length}</b> คน
      </div>
      {wards.map((w, i) => (
        <div key={w.id} className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-[var(--shadow-soft)]">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
            {i + 1}
          </div>
          <div className="flex-1 text-sm font-semibold">{w.name}</div>
          <div className="rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">
            รับ <b className="text-foreground">{w.capacity}</b> คน
          </div>
        </div>
      ))}
    </div>
  );
}

function WardsAdmin({
  wards,
  onSave,
  busy,
}: {
  wards: Ward[];
  onSave: (wards: Ward[]) => Promise<unknown>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Ward[]>(wards);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setDraft(wards);
    setSaved(true);
  }, [wards]);

  const markDirty = (next: Ward[]) => {
    setDraft(next);
    setSaved(false);
  };
  const update = (id: string, patch: Partial<Ward>) =>
    markDirty(draft.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const add = () =>
    markDirty([...draft, { id: uid(), name: `หวอด ${draft.length + 1}`, capacity: 5 }]);
  const remove = (id: string) => markDirty(draft.filter((w) => w.id !== id));

  const total = draft.reduce((s, w) => s + w.capacity, 0);

  const save = async () => {
    await onSave(draft);
    setSaved(true);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-accent/30 p-3 text-center text-xs text-accent-foreground">
        รับได้รวม <b>{total}</b> คน
      </div>
      {draft.map((w, i) => (
        <div key={w.id} className="flex items-center gap-2 rounded-2xl bg-card p-3 shadow-[var(--shadow-soft)]">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
            {i + 1}
          </div>
          <input
            value={w.name}
            onChange={(e) => update(w.id, { name: e.target.value })}
            className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-sm font-medium outline-none focus:bg-muted"
          />
          <div className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1">
            <span className="text-xs text-muted-foreground">รับ</span>
            <input
              type="number"
              min={1}
              value={w.capacity}
              onChange={(e) => update(w.id, { capacity: Math.max(1, parseInt(e.target.value) || 1) })}
              className="w-12 bg-transparent text-center text-sm font-semibold outline-none"
            />
          </div>
          <button
            onClick={() => remove(w.id)}
            className="rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="w-full rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
      >
        + เพิ่มหวอด
      </button>
      <button
        onClick={save}
        disabled={busy || saved}
        className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow transition disabled:opacity-40"
      >
        {saved ? "บันทึกแล้ว" : "บันทึก"}
      </button>
    </div>
  );
}

/* ============ RESULTS ============ */

function ResultsPanel({ state, onRun, busy }: { state: State; onRun?: () => Promise<unknown>; busy?: boolean }) {
  const { wards, participants, assignments } = state;

  const grouped = (() => {
    if (!assignments) return null;
    const map = new Map<string, { p: Participant; rank: number }[]>();
    wards.forEach((w) => map.set(w.id, []));
    assignments.forEach((a) => {
      const p = participants.find((x) => x.code === a.code);
      if (!p) return;
      if (a.wardId) map.get(a.wardId)?.push({ p, rank: a.rank! });
    });
    return map;
  })();

  const stats = (() => {
    if (!assignments) return null;
    const s = { 1: 0, 2: 0, other: 0, none: 0 };
    assignments.forEach((a) => {
      if (a.rank === 1) s[1]++;
      else if (a.rank === 2) s[2]++;
      else if (a.rank === null) s.none++;
      else s.other++;
    });
    return s;
  })();

  return (
    <div className="space-y-4">
      {onRun && (
        <button
          onClick={() => onRun()}
          disabled={participants.length === 0 || busy}
          className="w-full rounded-2xl bg-primary py-4 text-base font-bold text-primary-foreground shadow-lg transition active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? "กำลังประมวลผล…" : "จัดสรรหวอด"}
        </button>
      )}

      {!assignments && (
        <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
          {onRun ? "กดปุ่มเพื่อจัดสรรหวอดตามอันดับ" : "ยังไม่มีการประกาศผลการจัดสรร"}
        </div>
      )}

      {assignments && stats && (
        <>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "อันดับ 1", val: stats[1], color: "bg-primary/15 text-primary" },
              { label: "อันดับ 2", val: stats[2], color: "bg-accent/40 text-accent-foreground" },
              { label: "อันดับ 3+", val: stats.other, color: "bg-secondary text-secondary-foreground" },
              { label: "รอจัดสรร", val: stats.none, color: "bg-destructive/10 text-destructive" },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl p-2 text-center ${s.color}`}>
                <div className="text-xl font-bold">{s.val}</div>
                <div className="text-[10px]">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {wards.map((w) => {
              const members = grouped?.get(w.id) ?? [];
              return (
                <div key={w.id} className="rounded-2xl bg-card p-3 shadow-[var(--shadow-soft)]">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="font-semibold">{w.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {members.length}/{w.capacity}
                    </div>
                  </div>
                  {members.length === 0 ? (
                    <div className="text-xs text-muted-foreground">— ว่าง —</div>
                  ) : (
                    <ul className="space-y-1">
                      {members.map(({ p, rank }) => (
                        <li
                          key={p.code}
                          className="flex items-center justify-between rounded-lg bg-muted px-2 py-1.5 text-sm"
                        >
                          <span className="truncate">
                            {p.name} <span className="text-[10px] text-muted-foreground">({p.code})</span>
                          </span>
                          <span
                            className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              rank === 1 ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"
                            }`}
                          >
                            อันดับ {rank}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {assignments.some((a) => a.wardId === null) && (
            <div className="rounded-2xl bg-destructive/10 p-3 text-xs text-destructive">
              มีผู้ลงทะเบียนที่ยังไม่ได้รับจัดสรร — เพิ่มจำนวนรับ แล้วจัดสรรใหม่อีกครั้ง
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============ MODAL ============ */

// Popup พื้นฐาน: กดพื้นหลัง (backdrop) หรือกด Esc เพื่อปิด
function Modal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose}>
      <div className="rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)]">
        <div className="text-base font-semibold">{title}</div>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl bg-muted py-3 text-sm font-semibold text-muted-foreground"
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-2xl bg-destructive py-3 text-sm font-semibold text-destructive-foreground disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ============ ADMIN ============ */

function AdminLogin({ onOk, onClose }: { onOk: () => void; onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const submit = () => (pw === ADMIN_PASSWORD ? onOk() : setErr("รหัสผ่านไม่ถูกต้อง"));
  return (
    <Modal onClose={onClose}>
      <div className="rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)]">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-sm font-semibold">เข้าสู่ระบบผู้ดูแล</div>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            ยกเลิก
          </button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">กรอกรหัสผ่านผู้ดูแลระบบ</p>
        <input
          type="password"
          value={pw}
          onChange={(e) => {
            setErr("");
            setPw(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="รหัสผ่าน"
          className="w-full rounded-xl bg-muted px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary/40"
        />
        {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
        <button
          onClick={submit}
          className="mt-3 w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          เข้าสู่ระบบ
        </button>
      </div>
    </Modal>
  );
}

// การ์ดตั้งค่าภาค/ปีการศึกษา (แสดงในแท็บหวอดของผู้ดูแล)
function SettingsCard({
  settings,
  onSave,
  busy,
}: {
  settings: Settings;
  onSave: (term: string, year: string) => Promise<unknown>;
  busy: boolean;
}) {
  const [term, setTerm] = useState(settings.term);
  const [year, setYear] = useState(settings.year);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setTerm(settings.term);
    setYear(settings.year);
    setSaved(true);
  }, [settings.term, settings.year]);

  const dirty = term.trim() !== settings.term || year.trim() !== settings.year;
  const canSave = !!term.trim() && !!year.trim() && dirty && !busy;

  const save = async () => {
    await onSave(term.trim(), year.trim());
    setSaved(true);
  };

  return (
    <div className="rounded-2xl bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="text-sm font-semibold">ภาค / ปีการศึกษา</div>
      <p className="mt-1 text-xs text-muted-foreground">แสดงบนหัวเรื่องของหน้าลงทะเบียน</p>
      <div className="mt-3 flex gap-2">
        <label className="flex-1 text-xs font-medium text-muted-foreground">
          ภาคการศึกษา
          <input
            value={term}
            inputMode="numeric"
            onChange={(e) => {
              setTerm(e.target.value.replace(/\D/g, "").slice(0, 1));
              setSaved(false);
            }}
            placeholder="2"
            className="mt-1 w-full rounded-xl bg-muted px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
        <label className="flex-1 text-xs font-medium text-muted-foreground">
          ปีการศึกษา
          <input
            value={year}
            inputMode="numeric"
            onChange={(e) => {
              setYear(e.target.value.replace(/\D/g, "").slice(0, 4));
              setSaved(false);
            }}
            placeholder="2569"
            className="mt-1 w-full rounded-xl bg-muted px-3 py-2.5 text-base tracking-widest outline-none focus:ring-2 focus:ring-primary/40"
          />
        </label>
      </div>
      <button
        onClick={save}
        disabled={!canSave}
        className="mt-3 w-full rounded-2xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
      >
        {saved && !dirty ? "บันทึกแล้ว" : "บันทึก"}
      </button>
    </div>
  );
}

/* ============ HISTORY ============ */

function fmtDateTH(iso: string) {
  try {
    return new Date(iso).toLocaleString("th-TH", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function RunsHistory() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const load = async () => {
    try {
      setErr("");
      setRuns(await API.runs());
    } catch (e: any) {
      setErr(e.message || "โหลดไม่ได้");
    }
  };
  useEffect(() => {
    load();
  }, []);

  if (err) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center text-sm text-destructive shadow-[var(--shadow-soft)]">
        ⚠️ {err}
      </div>
    );
  }
  if (!runs) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
        กำลังโหลด…
      </div>
    );
  }
  if (runs.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
        ยังไม่มีประวัติการสุ่ม
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((run, idx) => {
        const open = openId === run.id;
        const latest = idx === 0;
        const byWard = new Map<string, RunItem[]>();
        const unplaced: RunItem[] = [];
        for (const it of run.items) {
          if (!it.wardId) {
            unplaced.push(it);
            continue;
          }
          if (!byWard.has(it.wardName)) byWard.set(it.wardName, []);
          byWard.get(it.wardName)!.push(it);
        }
        return (
          <div key={run.id} className="rounded-2xl bg-card p-3 shadow-[var(--shadow-soft)]">
            <button
              onClick={() => setOpenId(open ? null : run.id)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">รอบที่ {run.id}</span>
                  {latest && (
                    <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                      ล่าสุด
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">{fmtDateTH(run.runAt)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-[10px]">
                <span className="rounded-md bg-primary/15 px-1.5 py-0.5 font-semibold text-primary">
                  1×{run.stats.r1}
                </span>
                <span className="rounded-md bg-accent/40 px-1.5 py-0.5 text-accent-foreground">
                  2×{run.stats.r2}
                </span>
                {run.stats.rnone > 0 && (
                  <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-destructive">
                    −{run.stats.rnone}
                  </span>
                )}
                <span className="ml-1 text-muted-foreground">{open ? "▲" : "▼"}</span>
              </div>
            </button>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-2">
                    <div className="text-[11px] text-muted-foreground">
                      รวม {run.total} คน • อันดับ 3+ {run.stats.rother} คน
                    </div>
                    {[...byWard.entries()].map(([wname, members]) => (
                      <div key={wname} className="rounded-xl bg-muted/60 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <div className="text-xs font-semibold">{wname}</div>
                          <div className="text-[10px] text-muted-foreground">{members.length} คน</div>
                        </div>
                        <ul className="space-y-1">
                          {members.map((it) => (
                            <li
                              key={it.code}
                              className="flex items-center justify-between rounded-lg bg-background px-2 py-1 text-sm"
                            >
                              <span className="truncate">
                                {it.name}{" "}
                                <span className="text-[10px] text-muted-foreground">({it.code})</span>
                              </span>
                              <span
                                className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                  it.rank === 1
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground"
                                }`}
                              >
                                อันดับ {it.rank}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {unplaced.length > 0 && (
                      <div className="rounded-xl bg-destructive/10 p-2">
                        <div className="mb-1 text-xs font-semibold text-destructive">
                          ไม่ได้หวอด ({unplaced.length})
                        </div>
                        <div className="text-[11px] text-destructive">
                          {unplaced.map((u) => u.name).join(" • ")}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function AdminView({
  state,
  busy,
  onExit,
  onSaveWards,
  onDeleteParticipant,
  onRun,
  onReset,
  onSaveSettings,
}: {
  state: State;
  busy: boolean;
  onExit: () => void;
  onSaveWards: (wards: Ward[]) => Promise<unknown>;
  onDeleteParticipant: (code: string) => Promise<unknown>;
  onRun: () => Promise<unknown>;
  onReset: () => Promise<unknown>;
  onSaveSettings: (term: string, year: string) => Promise<unknown>;
}) {
  const [tab, setTab] = useState<"wards" | "list" | "results" | "history">("results");
  const [showReset, setShowReset] = useState(false);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background px-4 pb-16 pt-6">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
            ผู้ดูแลระบบ
          </div>
          <button
            onClick={onExit}
            className="rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            ← ออก
          </button>
        </div>
        <LayoutGroup id="admin-tabs">
          <nav className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-card p-1 shadow-[var(--shadow-soft)]">
            {[
              { k: "results", label: "จัดสรร / ผล" },
              { k: "list", label: `รายชื่อ (${state.participants.length})` },
              { k: "wards", label: `หวอด (${state.wards.length})` },
              { k: "history", label: "ประวัติ" },
            ].map((t) => {
              const active = tab === t.k;
              return (
                <button
                  key={t.k}
                  onClick={() => setTab(t.k as typeof tab)}
                  className={`relative rounded-xl px-1 py-2 text-[11px] font-semibold ${
                    active ? "text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="admin-tab-pill"
                      className="absolute inset-0 rounded-xl bg-primary"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    />
                  )}
                  <span className="relative z-10">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </LayoutGroup>

        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === "wards" && (
              <div className="space-y-3">
                <SettingsCard settings={state.settings} onSave={onSaveSettings} busy={busy} />
                <WardsAdmin wards={state.wards} onSave={onSaveWards} busy={busy} />
              </div>
            )}
            {tab === "list" && (
              <ListPanel
                state={state}
                meCode=""
                isAdmin
                onDeleteParticipant={onDeleteParticipant}
              />
            )}
            {tab === "results" && (
              <ResultsPanel state={state} onRun={onRun} busy={busy} />
            )}
            {tab === "history" && <RunsHistory />}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 text-center">
          <button
            onClick={() => setShowReset(true)}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-destructive"
          >
            ล้างข้อมูลทั้งหมด
          </button>
        </div>
      </div>

      {showReset && (
        <ConfirmModal
          title="ล้างข้อมูลทั้งหมด?"
          message="ระบบจะลบรายชื่อผู้ลงทะเบียน การจัดอันดับ และผลการจัดสรรทั้งหมด การลบนี้กู้คืนไม่ได้"
          confirmLabel="ล้างข้อมูล"
          busy={busy}
          onConfirm={async () => {
            await onReset();
            setShowReset(false);
          }}
          onClose={() => setShowReset(false)}
        />
      )}
    </div>
  );
}
