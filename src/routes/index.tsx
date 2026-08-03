import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import {
  googleEnabled,
  initGoogle,
  promptOneTap,
  renderGoogleButton,
  loadStoredToken,
  clearStoredToken,
} from "../google";

export const Route = createFileRoute("/")({
  component: Index,
});

type Ward = { id: string; name: string; capacity: number; pos?: number };
// เทมเพลต = preset ชุดวอร์ดตั้งชื่อ (wards ไม่มี pos)
type WardTemplate = { id: string; name: string; wards: Ward[] };
// code = public (masked สำหรับ non-admin), rid = opaque id ใช้จับคู่ตัวตน
// offRoster/email เติมเฉพาะ payload admin
type Participant = {
  code: string;
  rid: string;
  name: string;
  choices: string[];
  offRoster?: boolean;
  email?: string | null;
};
type Assignment = { code: string; rid?: string; wardId: string | null; rank: number | null };
type Settings = { term: string; year: string; title: string };
const DEFAULT_TITLE =
  "ลงทะเบียนการฝึกปฏิบัติผู้นำทีมการพยาบาล และการฝึกปฏิบัติเพื่อเตรียมเข้าสู่วิชาชีพ";
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
  registrationOpen: boolean;
};
type MeData = { code: string; rid: string; name: string; choices: string[]; offRoster: boolean };
type RosterEntry = { code: string; name: string };

/* ============ API ============ */

const json = async (r: Response) => {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any)?.error || `HTTP ${r.status}`);
  return data;
};
const bearer = (token?: string | null): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};

const API = {
  // public โหลด /api/state (CDN cache ได้ = กันโหลด 500 concurrent); cache:"no-store" ให้ browser ไม่เสิร์ฟ stale
  // (browser ถามใหม่ทุกครั้ง แต่ CDN ตอบจาก cache ของมัน) → realtime ภายใน s-maxage. admin/หลังบันทึกแนบ ?t= bypass ทั้ง CDN
  getState: (adminKey?: string, bust?: boolean) =>
    fetch(adminKey || bust ? `/api/state?t=${Date.now()}` : "/api/state", {
      headers: adminKey ? { "x-admin-key": adminKey } : {},
      cache: "no-store",
    }).then<State>(json),
  // การลงทะเบียนของบัญชี Google ที่ login อยู่ (รหัสเต็ม, ของตัวเอง)
  me: (token: string) =>
    fetch("/api/me", { headers: { ...bearer(token) }, cache: "no-store" }).then<{
      registered: boolean;
      code?: string;
      rid?: string;
      name?: string;
      choices?: string[];
      offRoster?: boolean;
    }>(json),
  // ชื่อจาก roster ตามรหัส (name auto-fill) — ต้อง login
  rosterName: (code: string, token: string) =>
    fetch(`/api/roster?code=${encodeURIComponent(code)}`, {
      headers: { ...bearer(token) },
      cache: "no-store",
    }).then<{ found: boolean; name?: string }>(json),
  saveParticipant: (code: string, name: string, choices: string[], token?: string | null) =>
    fetch("/api/participant", {
      method: "PUT",
      headers: { "content-type": "application/json", ...bearer(token) },
      body: JSON.stringify({ code, name, choices }),
    }).then<{ ok: true; rid: string; code: string; name: string; choices: string[]; offRoster: boolean }>(json),
  deleteParticipant: (code: string, auth?: { token?: string | null; adminKey?: string }) =>
    fetch(`/api/participant?code=${encodeURIComponent(code)}`, {
      method: "DELETE",
      headers: {
        ...(auth?.adminKey ? { "x-admin-key": auth.adminKey } : {}),
        ...bearer(auth?.token),
      },
    }).then(json),
  saveWards: (wards: Ward[], auth: { adminKey: string }) =>
    fetch("/api/wards", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-key": auth.adminKey },
      body: JSON.stringify({ wards }),
    }).then(json),
  getWardTemplates: (auth: { adminKey: string }) =>
    fetch("/api/ward-templates", {
      headers: { "x-admin-key": auth.adminKey },
      cache: "no-store",
    }).then<WardTemplate[]>(json),
  saveWardTemplate: (t: WardTemplate, auth: { adminKey: string }) =>
    fetch("/api/ward-templates", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-key": auth.adminKey },
      body: JSON.stringify(t),
    }).then(json),
  deleteWardTemplate: (id: string, auth: { adminKey: string }) =>
    fetch(`/api/ward-templates?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-admin-key": auth.adminKey },
    }).then(json),
  saveSettings: (term: string, year: string, title: string, auth: { adminKey: string }) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-key": auth.adminKey },
      body: JSON.stringify({ term, year, title }),
    }).then(json),
  setRegistrationOpen: (open: boolean, auth: { adminKey: string }) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-key": auth.adminKey },
      body: JSON.stringify({ registrationOpen: open }),
    }).then(json),
  getRoster: (auth: { adminKey: string }) =>
    fetch("/api/roster", { headers: { "x-admin-key": auth.adminKey }, cache: "no-store" }).then<
      RosterEntry[]
    >(json),
  saveRoster: (roster: RosterEntry[], auth: { adminKey: string }) =>
    fetch("/api/roster", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-key": auth.adminKey },
      body: JSON.stringify({ roster }),
    }).then<{ ok: true; count: number }>(json),
  run: (auth: { adminKey: string }) =>
    fetch("/api/run", { method: "POST", headers: { "x-admin-key": auth.adminKey } }).then<{
      assignments: Assignment[];
      runAt: string;
    }>(json),
  runs: (auth?: { adminKey?: string }) =>
    fetch("/api/run", {
      headers: auth?.adminKey ? { "x-admin-key": auth.adminKey } : {},
    }).then<RunSummary[]>(json),
  reset: (scope: string, auth: { adminKey: string }) =>
    fetch(`/api/reset?scope=${encodeURIComponent(scope)}`, {
      method: "POST",
      headers: { "x-admin-key": auth.adminKey },
    }).then(json),
};

const uid = () => Math.random().toString(36).slice(2, 10);

// toast message หลัง reset ตามขอบเขต
const RESET_MSG: Record<"participants" | "runs" | "wards" | "roster", string> = {
  participants: "ลบผู้ลงทะเบียนทั้งหมดเรียบร้อยแล้ว",
  runs: "ล้างผลการจัดสรรเรียบร้อยแล้ว",
  wards: "รีเซ็ตวอร์ดเป็นค่าเริ่มต้นเรียบร้อยแล้ว",
  roster: "ล้างรายชื่อรุ่นเรียบร้อยแล้ว",
};

function Index() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminOk, setAdminOk] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  // ตัวตนผูกกับ Google (ดู docs/adr/0001): idToken = ID token (JWT), me = การลงทะเบียนของบัญชีนี้
  const [idToken, setIdToken] = useState<string | null>(() => loadStoredToken());
  const [me, setMe] = useState<MeData | null>(null);
  const loggedIn = !!idToken;
  const meRid = me?.rid ?? "";
  const taps = useRef(0);
  const tapTimer = useRef<number | null>(null);

  // โหลดการลงทะเบียนของบัญชีที่ login (รหัสเต็ม, ของตัวเอง)
  const loadMe = async (token: string) => {
    try {
      const r = await API.me(token);
      if (r.registered) {
        setMe({
          code: r.code!,
          rid: r.rid!,
          name: r.name!,
          choices: r.choices ?? [],
          offRoster: !!r.offRoster,
        });
      } else {
        setMe(null);
      }
    } catch {
      // token หมดอายุ/ใช้ไม่ได้ → ตัดตัวตนทิ้ง (ให้ login ใหม่)
      clearStoredToken();
      setIdToken(null);
      setMe(null);
    }
  };

  // Google callback → เก็บ token + โหลด me. ใช้ ref ให้ initGoogle (เรียกครั้งเดียว) ได้ closure ล่าสุดเสมอ
  const handleToken = (token: string) => {
    setIdToken(token);
    loadMe(token);
  };
  const handleTokenRef = useRef(handleToken);
  handleTokenRef.current = handleToken;

  const logout = () => {
    clearStoredToken();
    setIdToken(null);
    setMe(null);
  };
  const signIn = () => promptOneTap();

  useEffect(() => {
    // มี token เก่าที่ยังไม่หมดอายุ → ใช้เลย ระหว่างรอ One Tap re-auth
    const stored = loadStoredToken();
    if (stored) loadMe(stored);
    // init GIS + One Tap (auto_select เด้งเองถ้า login Google อยู่แล้ว)
    if (googleEnabled()) {
      initGoogle((t) => handleTokenRef.current(t)).then((ok) => {
        if (ok && !stored) promptOneTap();
      });
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async (overrideKey?: string, bust?: boolean) => {
    try {
      setError("");
      const key = overrideKey ?? (adminOk ? adminKey : undefined);
      const s = await API.getState(key, bust);
      setState(s);
    } catch (e: any) {
      setError(e.message || "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่");
    }
  };

  // auto-refresh (realtime): poll ทุก 5s ผ่าน cached endpoint (CDN ช่วยรับโหลด)
  // ข้ามตอน busy (กันชน mutation) และตอนแท็บซ่อน. pollRef อัปเดตทุก render → ได้ closure ล่าสุด
  const pollRef = useRef<() => void>(() => {});
  pollRef.current = () => {
    if (!busy && typeof document !== "undefined" && !document.hidden) refresh();
  };
  useEffect(() => {
    const id = window.setInterval(() => pollRef.current(), 5000);
    // กลับมาโฟกัสแท็บ → refresh ทันที ไม่ต้องรอรอบ poll ถัดไป
    const onVis = () => {
      if (!document.hidden) pollRef.current();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  const runBusy = async <T,>(fn: () => Promise<T>, okMsg?: string) => {
    setBusy(true);
    const start = Date.now();
    try {
      const r = await fn();
      await refresh(undefined, true); // หลัง mutation: bypass CDN cache เห็นข้อมูลตัวเองทันที
      // บังคับให้ busy state แสดงอย่างน้อย 250ms กัน flicker (เดิม 450ms รู้สึกช้า)
      const elapsed = Date.now() - start;
      if (elapsed < 250) await new Promise((res) => setTimeout(res, 250 - elapsed));
      if (okMsg) showToast(okMsg, "ok");
      return r;
    } catch (e: any) {
      const msg = e?.message || "เกิดข้อผิดพลาด";
      setError(msg);
      showToast(msg, "err");
    } finally {
      setBusy(false);
    }
  };

  const onSaveParticipant = (code: string, name: string, choices: string[]) =>
    runBusy(async () => {
      const r = await API.saveParticipant(code, name, choices, idToken);
      setMe({ code: r.code, rid: r.rid, name: r.name, choices: r.choices, offRoster: r.offRoster });
    }, "บันทึกข้อมูลเรียบร้อยแล้ว");
  // code ต้องเป็นรหัสเต็ม (admin ใช้ p.code จริง, ผู้ใช้ทั่วไปลบได้แต่ตัวเอง = me.code)
  const onDeleteParticipant = (code: string) =>
    runBusy(
      async () => {
        await API.deleteParticipant(code, {
          token: idToken,
          adminKey: adminOk ? adminKey : undefined,
        });
        if (me && code === me.code) setMe(null);
      },
      "ลบข้อมูลเรียบร้อยแล้ว",
    );
  const onSaveWards = (wards: Ward[]) =>
    runBusy(() => API.saveWards(wards, { adminKey }), "บันทึกวอร์ดเรียบร้อยแล้ว");
  const onRun = () => runBusy(() => API.run({ adminKey }), "จัดสรรเสร็จเรียบร้อย");
  const onResetScope = (scope: "participants" | "runs" | "wards" | "roster") =>
    runBusy(
      () => API.reset(scope, { adminKey }),
      RESET_MSG[scope],
    );
  const onSaveSettings = (term: string, year: string, title: string) =>
    runBusy(() => API.saveSettings(term, year, title, { adminKey }), "บันทึกการตั้งค่าเรียบร้อยแล้ว");
  const onSetRegistrationOpen = (open: boolean) =>
    runBusy(
      () => API.setRegistrationOpen(open, { adminKey }),
      open ? "เปิดรับลงทะเบียนแล้ว" : "ปิดรับลงทะเบียนแล้ว",
    );
  const onSaveRoster = (roster: RosterEntry[]) =>
    runBusy(() => API.saveRoster(roster, { adminKey }), "บันทึกรายชื่อรุ่นแล้ว");

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
          {state?.settings.title ?? DEFAULT_TITLE}
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
          meRid={meRid}
          loggedIn={loggedIn}
          idToken={idToken}
          busy={busy}
          onSignIn={signIn}
          onLogout={logout}
          onSaveParticipant={onSaveParticipant}
          onDeleteParticipant={onDeleteParticipant}
        />
      )}

      {error && state && (
        <p className="mt-3 text-center text-xs text-destructive">{error}</p>
      )}

      {adminMode && !adminOk && (
        <AdminLogin
          onOk={(key) => {
            setAdminKey(key);
            setAdminOk(true);
            // โหลด state ใหม่พร้อม key เพื่อให้เห็นรหัสเต็ม (ไม่ถูก mask)
            refresh(key);
          }}
          onClose={() => setAdminMode(false)}
        />
      )}
      {adminMode && adminOk && state && (
        <AdminView
          state={state}
          busy={busy}
          adminKey={adminKey}
          onExit={() => {
            setAdminOk(false);
            setAdminMode(false);
            setAdminKey("");
            refresh(""); // โหลดใหม่แบบ mask (ไม่มี key)
          }}
          onSaveWards={onSaveWards}
          onDeleteParticipant={onDeleteParticipant}
          onRun={onRun}
          onReset={onResetScope}
          onSaveSettings={onSaveSettings}
          onSetRegistrationOpen={onSetRegistrationOpen}
          onSaveRoster={onSaveRoster}
          notify={showToast}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}

/* ============ TOAST ============ */

function Toast({ toast }: { toast: { msg: string; type: "ok" | "err" } | null }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4"
        >
          <div
            className={`pointer-events-auto flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg ${
              toast.type === "ok"
                ? "bg-primary text-primary-foreground"
                : "bg-destructive text-destructive-foreground"
            }`}
          >
            <span>{toast.type === "ok" ? "✓" : "⚠️"}</span>
            <span>{toast.msg}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============ USER ============ */

function UserView({
  state,
  me,
  meRid,
  loggedIn,
  idToken,
  busy,
  onSignIn,
  onLogout,
  onSaveParticipant,
  onDeleteParticipant,
}: {
  state: State;
  me: MeData | null;
  meRid: string;
  loggedIn: boolean;
  idToken: string | null;
  busy: boolean;
  onSignIn: () => void;
  onLogout: () => void;
  onSaveParticipant: (code: string, name: string, choices: string[]) => Promise<unknown>;
  onDeleteParticipant: (code: string) => Promise<unknown>;
}) {
  const [tab, setTab] = useState<"me" | "list" | "wards" | "results">("me");
  const meCode = me?.code ?? "";

  return (
    <>
      <LayoutGroup id="user-tabs">
        <nav className="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-card p-1 shadow-[var(--shadow-soft)]">
          {[
            { k: "me", label: me ? "ข้อมูลของฉัน" : "ลงทะเบียน" },
            { k: "list", label: `รายชื่อ (${state.participants.length})` },
            { k: "wards", label: "วอร์ด" },
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
              loggedIn={loggedIn}
              idToken={idToken}
              busy={busy}
              onSignIn={onSignIn}
              onLogout={onLogout}
              onSaveParticipant={onSaveParticipant}
              onDeleteParticipant={() => (meCode ? onDeleteParticipant(meCode) : Promise.resolve())}
            />
          )}
          {tab === "list" && (
            <ListPanel
              state={state}
              meCode={meCode}
              meRid={meRid}
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
  loggedIn,
  idToken,
  busy,
  onSignIn,
  onLogout,
  onSaveParticipant,
  onDeleteParticipant,
}: {
  state: State;
  me: MeData | null;
  loggedIn: boolean;
  idToken: string | null;
  busy: boolean;
  onSignIn: () => void;
  onLogout: () => void;
  onSaveParticipant: (code: string, name: string, choices: string[]) => Promise<unknown>;
  onDeleteParticipant: () => Promise<unknown>;
}) {
  const wards = state.wards;
  const N = wards.length;
  const closed = !state.registrationOpen;

  const [name, setName] = useState(me?.name ?? "");
  const [code, setCode] = useState(me?.code ?? "");
  const [choices, setChoices] = useState<string[]>(
    me?.choices?.length
      ? [...me.choices, ...Array(Math.max(0, N - me.choices.length)).fill("")].slice(0, N)
      : Array(N).fill(""),
  );
  const [err, setErr] = useState("");
  // roster name auto-fill: 'idle'|'checking'|'found'|'none'
  const [rosterState, setRosterState] = useState<{ status: string; name?: string }>({ status: "idle" });

  // reset/resize ฟอร์มเฉพาะตอนตัวตนเปลี่ยน (login/logout) หรือจำนวนวอร์ดเปลี่ยน
  // ไม่ผูกกับ `me` object ตรงๆ ไม่งั้น auto-refresh (polling) จะ reset ทับที่ผู้ใช้กำลังพิมพ์
  useEffect(() => {
    if (me) {
      setName(me.name);
      setCode(me.code);
      setChoices([...me.choices, ...Array(Math.max(0, N - me.choices.length)).fill("")].slice(0, N));
      setRosterState({ status: me.offRoster ? "none" : "found", name: me.name });
    } else {
      setChoices((prev) =>
        prev.length === N ? prev : [...prev, ...Array(Math.max(0, N - prev.length)).fill("")].slice(0, N),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.rid, N]);

  const usedBefore = (idx: number) => new Set(choices.slice(0, idx).filter(Boolean));
  const validCode = /^\d{9}$/.test(code);

  // สมัครใหม่: พิมพ์รหัส → ดึงชื่อจาก roster มาเติมให้ (read-only). นอก roster → กรอกชื่อเอง
  useEffect(() => {
    if (me || !validCode || !idToken) {
      if (!me) setRosterState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setRosterState({ status: "checking" });
    const t = window.setTimeout(() => {
      API.rosterName(code, idToken)
        .then((r) => {
          if (cancelled) return;
          if (r.found) {
            setRosterState({ status: "found", name: r.name });
            setName(r.name ?? "");
          } else {
            setRosterState({ status: "none" });
          }
        })
        .catch(() => {
          if (!cancelled) setRosterState({ status: "idle" });
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [code, me, validCode, idToken]);

  // ชื่อถูกล็อกเมื่อดึงจาก roster ได้ (roster = source of truth)
  const nameLocked = rosterState.status === "found";
  const canSubmit =
    !!name.trim() && validCode && !closed && choices.every((c) => c) && (me ? true : !!idToken);

  const submit = async () => {
    setErr("");
    if (!name.trim()) return setErr("กรุณากรอกชื่อ–นามสกุล");
    if (!validCode) return setErr("รหัสนักศึกษาต้องเป็นตัวเลข 9 หลัก");
    if (!choices.every((c) => c)) return setErr("กรุณาจัดอันดับวอร์ดให้ครบทุกอันดับ");
    // 12(C)/ownership/ปิดรับ → server ตอบ error, แสดงผ่าน toast จาก runBusy
    await onSaveParticipant(code, name.trim(), choices);
  };

  const deleteMe = async () => {
    if (!me) return;
    if (!confirm("ยกเลิกการลงทะเบียนของคุณ? ข้อมูลที่กรอกไว้จะถูกลบ")) return;
    await onDeleteParticipant();
    setName("");
    setCode("");
    setChoices(Array(N).fill(""));
    setRosterState({ status: "idle" });
  };

  // ยังไม่ login → บังคับ login Google ก่อนเข้าฟอร์ม (ดู docs/adr/0001)
  if (!loggedIn) {
    return <LoginGate onSignIn={onSignIn} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-2xl bg-accent/30 px-3 py-2 text-[11px]">
        <span className="text-accent-foreground">เข้าสู่ระบบด้วย Google แล้ว</span>
        <button onClick={onLogout} className="font-semibold text-muted-foreground underline underline-offset-2">
          ออกจากระบบ
        </button>
      </div>

      {closed && (
        <div className="rounded-2xl bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          {me ? "ปิดรับลงทะเบียนแล้ว — ดูข้อมูลได้ แต่แก้ไขไม่ได้" : "ปิดรับลงทะเบียนแล้ว"}
        </div>
      )}

      {closed && !me ? null : (
      <div className="rounded-3xl bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">{me ? "แก้ไขข้อมูลการลงทะเบียน" : "ลงทะเบียน"}</div>
          {me && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              ลงทะเบียนแล้ว
            </span>
          )}
        </div>

        <label className="mt-1 block text-xs font-medium text-muted-foreground">
          รหัสนักศึกษา 9 หลัก
        </label>
        <input
          value={code}
          inputMode="numeric"
          maxLength={9}
          disabled={!!me || closed}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 9))}
          placeholder="เช่น 123456789"
          className="mt-1 w-full rounded-xl bg-muted px-3 py-2.5 text-base tracking-widest outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
        />
        {code && !validCode && <p className="mt-1 text-[11px] text-destructive">รหัสนักศึกษาต้องเป็นตัวเลข 9 หลัก</p>}
        {!me && rosterState.status === "none" && validCode && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            ไม่พบรหัสนี้ในรายชื่อรุ่น — ลงทะเบียนได้ แต่แอดมินจะตรวจสอบภายหลัง
          </p>
        )}

        <label className="mt-3 block text-xs font-medium text-muted-foreground">
          ชื่อ–นามสกุล{nameLocked && " (จากรายชื่อรุ่น)"}
        </label>
        <input
          value={name}
          readOnly={nameLocked}
          disabled={closed}
          onChange={(e) => setName(e.target.value)}
          placeholder={rosterState.status === "checking" ? "กำลังดึงชื่อ…" : "ชื่อ–นามสกุล"}
          className={`mt-1 w-full rounded-xl px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 ${
            nameLocked ? "bg-muted/60 text-muted-foreground" : "bg-muted"
          }`}
        />

        <div className="mt-4 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">จัดอันดับวอร์ดทั้งหมด {N} อันดับ</div>
          {choices.map((val, i) => {
            const used = usedBefore(i);
            return (
              <div key={i} className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <select
                  value={val}
                  disabled={closed}
                  onChange={(e) => {
                    const next = [...choices];
                    next[i] = e.target.value;
                    // แก้ลำดับก่อนหน้า → ล้างลำดับข้างหลัง กัน duplicate + บังคับเลือกตามลำดับ
                    for (let k = i + 1; k < next.length; k++) next[k] = "";
                    setChoices(next);
                  }}
                  className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                >
                  <option value="">— เลือกวอร์ด —</option>
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
          disabled={!canSubmit || busy}
          className="mt-4 w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow transition disabled:opacity-40"
        >
          {busy ? "กำลังบันทึก…" : me ? "บันทึกการเปลี่ยนแปลง" : "ลงทะเบียน"}
        </button>

        {me && (
          <button
            onClick={deleteMe}
            disabled={busy || closed}
            className="mt-2 w-full rounded-2xl bg-destructive/10 py-2.5 text-xs font-semibold text-destructive disabled:opacity-40"
          >
            {busy ? "กำลังลบ…" : "ยกเลิกการลงทะเบียน"}
          </button>
        )}
      </div>
      )}
    </div>
  );
}

// ยังไม่ login → การ์ดเชิญ login Google (One Tap เด้งเองอยู่แล้วถ้าใช้ได้; ปุ่มนี้เป็น safety net)
function LoginGate({ onSignIn }: { onSignIn: () => void }) {
  const btnRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (btnRef.current) renderGoogleButton(btnRef.current);
  }, []);
  return (
    <div className="rounded-3xl bg-card p-6 text-center shadow-[var(--shadow-soft)]">
      <div className="text-sm font-semibold">เข้าสู่ระบบเพื่อลงทะเบียน</div>
      <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
        ลงชื่อเข้าใช้ด้วย Google เพื่อยืนยันตัวตนและแก้ไขข้อมูล
      </p>
      <div className="mt-4 flex justify-center">
        <div ref={btnRef} />
      </div>
      <button
        onClick={onSignIn}
        className="mt-3 text-[11px] text-muted-foreground underline underline-offset-2"
      >
        ไม่เห็นปุ่ม? กดที่นี่
      </button>
    </div>
  );
}

/* ============ SHARED LIST ============ */

function ListPanel({
  state,
  meCode,
  meRid,
  isAdmin,
  onDeleteParticipant,
}: {
  state: State;
  meCode: string;
  meRid: string;
  isAdmin: boolean;
  onDeleteParticipant: (code: string) => Promise<unknown>;
}) {
  const [q, setQ] = useState("");
  const [deletingRid, setDeletingRid] = useState<string | null>(null);
  const filtered = state.participants.filter((p) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return p.name.toLowerCase().includes(s) || p.code.includes(s);
  });

  // ต้องส่งรหัสเต็มเข้า API: admin มี p.code จริงอยู่แล้ว, ผู้ใช้ทั่วไปลบได้แต่ตัวเอง → ใช้ meCode
  const remove = async (p: Participant) => {
    if (!confirm("ลบรายชื่อนี้ออกจากระบบ?")) return;
    setDeletingRid(p.rid);
    try {
      await onDeleteParticipant(isAdmin ? p.code : meCode);
    } finally {
      setDeletingRid(null);
    }
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
            const isMe = !!meRid && p.rid === meRid;
            const canDelete = isAdmin || isMe;
            return (
              <div key={p.rid} className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-[var(--shadow-soft)]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{p.name}</span>
                    {isMe && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                        ฉัน
                      </span>
                    )}
                    {isAdmin && p.offRoster && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">
                        นอกรายชื่อ
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    รหัส {p.code}
                    {isAdmin && p.email ? ` · ${p.email}` : ""}
                  </div>
                </div>
                {canDelete && (
                  <button
                    onClick={() => remove(p)}
                    disabled={deletingRid === p.rid}
                    className="rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {deletingRid === p.rid ? "กำลังลบ…" : "ลบ"}
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
  adminKey,
  notify,
}: {
  wards: Ward[];
  onSave: (wards: Ward[]) => Promise<unknown>;
  busy: boolean;
  adminKey: string;
  notify: (msg: string, type?: "ok" | "err") => void;
}) {
  const [draft, setDraft] = useState<Ward[]>(wards);
  const [saved, setSaved] = useState(true);
  const [tpls, setTpls] = useState<WardTemplate[]>([]);
  const [tplBusy, setTplBusy] = useState(false);

  // sync draft เฉพาะตอน "เนื้อหา" wards เปลี่ยนจริง (ไม่ใช่ทุก refresh/poll)
  // ถ้าผูกกับ `wards` (array ref) → polling ทุก 5s จะ reset ทับที่ admin กำลังพิมพ์
  const wardsSig = wards.map((w) => `${w.id}|${w.name}|${w.capacity}`).join(";;");
  useEffect(() => {
    setDraft(wards);
    setSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wardsSig]);

  const loadTpls = () => {
    API.getWardTemplates({ adminKey })
      .then(setTpls)
      .catch(() => notify("โหลดเทมเพลตไม่สำเร็จ", "err"));
  };
  useEffect(loadTpls, [adminKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const markDirty = (next: Ward[]) => {
    setDraft(next);
    setSaved(false);
  };
  const update = (id: string, patch: Partial<Ward>) =>
    markDirty(draft.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const add = () =>
    markDirty([...draft, { id: uid(), name: `วอร์ด ${draft.length + 1}`, capacity: 5 }]);
  const remove = (id: string) => markDirty(draft.filter((w) => w.id !== id));

  const total = draft.reduce((s, w) => s + w.capacity, 0);

  const save = async () => {
    await onSave(draft);
    setSaved(true);
  };

  // popup ตั้งชื่อเทมเพลต
  const [naming, setNaming] = useState(false);
  const [tplName, setTplName] = useState("");

  const confirmSaveTpl = async () => {
    const name = tplName.trim();
    if (!name) return;
    setTplBusy(true);
    try {
      await API.saveWardTemplate(
        {
          id: uid(),
          name,
          // strip pos — เก็บเฉพาะ id/name/capacity
          wards: draft.map(({ id, name: n, capacity }) => ({ id, name: n, capacity })),
        },
        { adminKey },
      );
      loadTpls();
      notify("บันทึกเทมเพลตแล้ว");
      setNaming(false);
    } catch (e: any) {
      notify(e?.message || "บันทึกเทมเพลตไม่สำเร็จ", "err");
    } finally {
      setTplBusy(false);
    }
  };

  // popup ยืนยันโหลด/ลบเทมเพลต (loadingTpl / deletingTpl = เทมเพลตที่กำลังถูกถาม)
  const [loadingTpl, setLoadingTpl] = useState<WardTemplate | null>(null);
  const [deletingTpl, setDeletingTpl] = useState<WardTemplate | null>(null);

  const confirmLoadTpl = () => {
    if (!loadingTpl) return;
    setDraft(loadingTpl.wards);
    setSaved(false);
    notify(`โหลด "${loadingTpl.name}" แล้ว — กดบันทึกเพื่อใช้งาน`);
    setLoadingTpl(null);
  };

  const confirmDelTpl = async () => {
    if (!deletingTpl) return;
    setTplBusy(true);
    try {
      await API.deleteWardTemplate(deletingTpl.id, { adminKey });
      loadTpls();
      notify("ลบเทมเพลตแล้ว");
      setDeletingTpl(null);
    } catch (e: any) {
      notify(e?.message || "ลบเทมเพลตไม่สำเร็จ", "err");
    } finally {
      setTplBusy(false);
    }
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
        + เพิ่มวอร์ด
      </button>
      <button
        onClick={save}
        disabled={busy || saved}
        className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow transition disabled:opacity-40"
      >
        {saved ? "บันทึกแล้ว" : "บันทึก"}
      </button>

      {/* เทมเพลตวอร์ด: preset ชุดวอร์ดตั้งชื่อ โหลดกลับมาแก้/บันทึกได้ */}
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">เทมเพลตวอร์ด</div>
        {tpls.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">ยังไม่มีเทมเพลต — เซฟชุดวอร์ดปัจจุบันเพื่อใช้ซ้ำ</p>
        ) : (
          <div className="space-y-1.5">
            {tpls.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.name}</div>
                  <div className="text-[11px] text-muted-foreground">{t.wards.length} วอร์ด</div>
                </div>
                <button
                  onClick={() => setLoadingTpl(t)}
                  disabled={tplBusy}
                  className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
                >
                  โหลด
                </button>
                <button
                  onClick={() => setDeletingTpl(t)}
                  disabled={tplBusy}
                  className="rounded-lg px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => setNaming(true)}
          disabled={tplBusy || draft.length === 0}
          className="mt-2.5 w-full rounded-xl border-2 border-dashed border-border py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
        >
          + บันทึกเป็นเทมเพลต
        </button>
      </div>

      {naming && (
        <Modal onClose={() => !tplBusy && setNaming(false)}>
          <div className="rounded-3xl bg-card p-6 shadow-[var(--shadow-soft)]">
            <div className="text-base font-semibold">ตั้งชื่อเทมเพลต</div>
            <input
              autoFocus
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tplName.trim() && !tplBusy) confirmSaveTpl();
              }}
              placeholder="เช่น เทอม 1/67"
              className="mt-3 w-full rounded-2xl bg-muted px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setNaming(false)}
                disabled={tplBusy}
                className="flex-1 rounded-2xl bg-muted py-3 text-sm font-semibold text-muted-foreground disabled:opacity-40"
              >
                ยกเลิก
              </button>
              <button
                onClick={confirmSaveTpl}
                disabled={tplBusy || !tplName.trim()}
                className="flex-1 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                {tplBusy ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {loadingTpl && (
        <ConfirmModal
          title={`โหลด "${loadingTpl.name}"`}
          message={
            saved
              ? `โหลดเทมเพลต (${loadingTpl.wards.length} วอร์ด) เข้าตัวแก้ไข — กด "บันทึก" ภายหลังเพื่อใช้งานจริง`
              : `การแก้ไขวอร์ดปัจจุบันยังไม่ได้บันทึก โหลดเทมเพลตทับเลยไหม? (${loadingTpl.wards.length} วอร์ด)`
          }
          confirmLabel="โหลด"
          onConfirm={confirmLoadTpl}
          onClose={() => setLoadingTpl(null)}
        />
      )}

      {deletingTpl && (
        <ConfirmModal
          title={`ลบเทมเพลต "${deletingTpl.name}"?`}
          message="ลบแล้วไม่สามารถกู้คืนได้"
          confirmLabel="ลบ"
          busy={tplBusy}
          onConfirm={confirmDelTpl}
          onClose={() => !tplBusy && setDeletingTpl(null)}
        />
      )}
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
      const p = participants.find((x) => (a.rid ? x.rid === a.rid : x.code === a.code));
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
          {busy ? "กำลังประมวลผล…" : "จัดสรรวอร์ด"}
        </button>
      )}

      {!assignments && (
        <div className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground shadow-[var(--shadow-soft)]">
          {onRun ? "กดปุ่มเพื่อจัดสรรวอร์ดตามอันดับ" : "ยังไม่มีการประกาศผลการจัดสรร"}
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
                          key={p.rid}
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

function AdminLogin({
  onOk,
  onClose,
}: {
  onOk: (key: string) => void;
  onClose: () => void;
}) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!pw.trim()) return setErr("กรอกรหัสผู้ดูแล");
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/run", { headers: { "x-admin-key": pw.trim() } });
      if (r.status === 401 || r.status === 403) return setErr("รหัสผู้ดูแลไม่ถูกต้อง");
      if (!r.ok) return setErr("ตรวจสอบไม่ได้ ลองอีกครั้ง");
      onOk(pw.trim());
    } catch {
      setErr("เชื่อมต่อไม่ได้");
    } finally {
      setBusy(false);
    }
  };

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
        <p className="mb-3 text-xs text-muted-foreground">กรอกรหัสผู้ดูแลระบบ</p>
        <input
          type="password"
          value={pw}
          onChange={(e) => {
            setErr("");
            setPw(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="รหัสผู้ดูแล"
          className="w-full rounded-xl bg-muted px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary/40"
        />
        {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
        <button
          onClick={submit}
          disabled={busy}
          className="mt-3 w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {busy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
        </button>
      </div>
    </Modal>
  );
}

// การ์ดตั้งค่าภาค/ปีการศึกษา (แสดงในแท็บวอร์ดของผู้ดูแล)
function SettingsCard({
  settings,
  onSave,
  busy,
}: {
  settings: Settings;
  onSave: (term: string, year: string, title: string) => Promise<unknown>;
  busy: boolean;
}) {
  const [title, setTitle] = useState(settings.title);
  const [term, setTerm] = useState(settings.term);
  const [year, setYear] = useState(settings.year);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    setTitle(settings.title);
    setTerm(settings.term);
    setYear(settings.year);
    setSaved(true);
  }, [settings.title, settings.term, settings.year]);

  const dirty =
    title.trim() !== settings.title ||
    term.trim() !== settings.term ||
    year.trim() !== settings.year;
  const canSave = !!title.trim() && !!term.trim() && !!year.trim() && dirty && !busy;

  const save = async () => {
    await onSave(term.trim(), year.trim(), title.trim());
    setSaved(true);
  };

  return (
    <div className="rounded-2xl bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="text-sm font-semibold">หัวเรื่อง / ภาค / ปีการศึกษา</div>
      <p className="mt-1 text-xs text-muted-foreground">แสดงบนหัวเรื่องของหน้าลงทะเบียน</p>
      <label className="mt-3 block text-xs font-medium text-muted-foreground">
        หัวเรื่อง
        <textarea
          value={title}
          rows={2}
          onChange={(e) => {
            setTitle(e.target.value.slice(0, 200));
            setSaved(false);
          }}
          placeholder={DEFAULT_TITLE}
          className="mt-1 w-full resize-none rounded-xl bg-muted px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-primary/40"
        />
      </label>
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

function RunsHistory({ adminKey }: { adminKey: string }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const load = async () => {
    try {
      setErr("");
      setRuns(await API.runs({ adminKey }));
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
                          ไม่ได้วอร์ด ({unplaced.length})
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

// parse ข้อความ paste จาก Excel (mirror parseRoster ฝั่ง server) — code<sep>name ต่อบรรทัด
function parseRosterText(text: string): { entries: RosterEntry[]; skipped: number } {
  const entries: RosterEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{9})[\s,]+(.+)$/.exec(line);
    if (!m || seen.has(m[1]) || !m[2].trim()) {
      skipped++;
      continue;
    }
    seen.add(m[1]);
    entries.push({ code: m[1], name: m[2].trim().slice(0, 100) });
  }
  return { entries, skipped };
}

// toggle Registration Window — ปิดเพื่อแช่แข็ง choices ก่อน run (ดู docs/adr/0002)
function RegistrationToggle({
  open,
  onToggle,
  busy,
}: {
  open: boolean;
  onToggle: (open: boolean) => Promise<unknown>;
  busy: boolean;
}) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            สถานะรับลงทะเบียน:{" "}
            <span className={open ? "text-primary" : "text-amber-600 dark:text-amber-400"}>
              {open ? "เปิด" : "ปิด"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            ปิดก่อนกดจัดสรร เพื่อล็อกไม่ให้ใครแก้อันดับระหว่างตรวจสอบ
          </p>
        </div>
        <button
          onClick={() => onToggle(!open)}
          disabled={busy}
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-40 ${
            open
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {open ? "ปิดรับสมัคร" : "เปิดรับสมัคร"}
        </button>
      </div>
    </div>
  );
}

// สรุปจำนวนคนนอกรายชื่อรุ่น (off-roster) ให้ admin ตรวจก่อน run
function OffRosterSummary({ participants }: { participants: Participant[] }) {
  const off = participants.filter((p) => p.offRoster);
  if (off.length === 0) return null;
  return (
    <div className="rounded-2xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
      <b>{off.length}</b> รายลงทะเบียนด้วยรหัสที่ไม่อยู่ในรายชื่อรุ่น — ตรวจสอบก่อนจัดสรร (มีป้าย “นอกรายชื่อ” ด้านล่าง)
    </div>
  );
}

// import roster: paste จาก Excel → preview → บันทึกทับทั้งชุด (replace-all, ไม่แตะ participants)
// count/reload มาจาก RosterPanel ที่ถือ roster ทั้งชุด (แหล่งเดียว ไม่ยิงซ้ำ)
function RosterCard({
  count,
  onSave,
  onSaved,
  busy,
}: {
  count: number | null;
  onSave: (roster: RosterEntry[]) => Promise<unknown>;
  onSaved: () => void;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const parsed = text.trim() ? parseRosterText(text) : null;

  const save = async () => {
    if (!parsed || parsed.entries.length === 0) return;
    await onSave(parsed.entries);
    setText("");
    onSaved();
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-soft)]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold">นำเข้ารายชื่อรุ่น</div>
          <div className="text-[11px] text-muted-foreground">
            {count == null ? "—" : `ตอนนี้มี ${count} รายชื่อ`} · วางจาก Excel ทับของเดิมทั้งชุด
          </div>
        </div>
        <span
          className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 px-4 pb-4 pt-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            รูปแบบ: รหัส 9 หลัก · เว้นวรรคหรือแท็บ · ชื่อ — บรรทัดละคน
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={"611010001\tสมหญิง ใจดี\n611010002\tสมชาย รักเรียน"}
            className="mt-2 w-full resize-y rounded-xl bg-muted px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-primary/40"
          />
          {parsed && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              อ่านได้ <b className="text-foreground">{parsed.entries.length}</b> แถว
              {parsed.skipped > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {" "}
                  · ข้าม {parsed.skipped} แถวที่รูปแบบไม่ถูก
                </span>
              )}
            </p>
          )}
          <button
            onClick={save}
            disabled={busy || !parsed || parsed.entries.length === 0}
            className="mt-3 w-full rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            {busy ? "กำลังบันทึก…" : "บันทึกรายชื่อ (ทับของเดิมทั้งชุด)"}
          </button>
        </div>
      )}
    </div>
  );
}

// tab "Roster": ตาราง roster จาก DB (source of truth) + import + ล้างทั้งชุด
// ทำเครื่องหมาย "ลงทะเบียนแล้ว" โดยเทียบ code กับ participants (admin payload มี code เต็ม)
function RosterPanel({
  adminKey,
  participants,
  onSave,
  onReset,
  busy,
}: {
  adminKey: string;
  participants: Participant[];
  onSave: (roster: RosterEntry[]) => Promise<unknown>;
  onReset: () => Promise<unknown>;
  busy: boolean;
}) {
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "reg" | "unreg">("all");

  const load = async () => {
    try {
      setErr("");
      setRoster(await API.getRoster({ adminKey }));
    } catch (e: any) {
      setErr(e.message || "โหลดไม่ได้");
    }
  };
  useEffect(() => {
    load();
  }, [adminKey]);

  const registered = useMemo(
    () => new Set(participants.map((p) => p.code)),
    [participants],
  );
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (roster ?? []).filter((r) => {
      const reg = registered.has(r.code);
      if (filter === "reg" && !reg) return false;
      if (filter === "unreg" && reg) return false;
      if (!term) return true;
      return r.code.includes(term) || r.name.toLowerCase().includes(term);
    });
  }, [roster, q, filter, registered]);
  const total = roster?.length ?? 0;
  const regCount = useMemo(
    () => (roster ?? []).filter((r) => registered.has(r.code)).length,
    [roster, registered],
  );

  return (
    <div className="space-y-3">
      {/* สรุปตัวเลขรวม: ทั้งรุ่น / ลงแล้ว / ยังไม่ลง */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "ทั้งรุ่น", value: total, tone: "text-foreground" },
          { label: "ลงทะเบียนแล้ว", value: regCount, tone: "text-primary" },
          { label: "ยังไม่ลง", value: total - regCount, tone: "text-muted-foreground" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl bg-card px-3 py-3 text-center shadow-[var(--shadow-soft)]"
          >
            <div className={`text-xl font-bold tabular-nums leading-none ${s.tone}`}>
              {roster ? s.value : "—"}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <RosterCard
        count={roster?.length ?? null}
        onSave={onSave}
        onSaved={load}
        busy={busy}
      />

      <div className="rounded-2xl bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="mb-3 text-sm font-semibold">รายชื่อในระบบ</div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหา รหัส หรือ ชื่อ"
          className="w-full rounded-xl bg-muted px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-primary/40"
        />

        <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {[
            { k: "all", label: "ทั้งหมด" },
            { k: "reg", label: "ลงแล้ว" },
            { k: "unreg", label: "ยังไม่ลง" },
          ].map((f) => (
            <button
              key={f.k}
              onClick={() => setFilter(f.k as typeof filter)}
              className={`rounded-lg py-1.5 text-[11px] font-semibold transition-colors ${
                filter === f.k
                  ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                  : "text-muted-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {err && <div className="py-8 text-center text-sm text-destructive">⚠️ {err}</div>}
        {!err && !roster && (
          <div className="py-8 text-center text-sm text-muted-foreground">กำลังโหลด…</div>
        )}
        {!err && roster && rows.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {total === 0 ? "ยังไม่มีรายชื่อรุ่นในระบบ" : "ไม่พบรายชื่อที่ค้นหา"}
          </div>
        )}
        {!err && roster && rows.length > 0 && (
          <>
            <div className="mt-3 max-h-[58vh] overflow-y-auto rounded-xl border border-border/60">
              <table className="w-full text-left">
                <thead className="sticky top-0 z-10 bg-muted/95 text-[10px] font-semibold text-muted-foreground backdrop-blur">
                  <tr>
                    <th className="w-9 px-3 py-2">#</th>
                    <th className="px-1 py-2">รหัส / ชื่อ</th>
                    <th className="px-3 py-2 text-right">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const reg = registered.has(r.code);
                    return (
                      <tr
                        key={r.code}
                        className="border-t border-border/50 align-top odd:bg-muted/25"
                      >
                        <td className="px-3 py-2.5 text-[11px] tabular-nums text-muted-foreground">
                          {i + 1}
                        </td>
                        <td className="px-1 py-2.5">
                          <div className="text-[13px] font-medium leading-snug">{r.name}</div>
                          <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                            {r.code}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span
                            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-bold ${
                              reg
                                ? "bg-primary/15 text-primary"
                                : "bg-foreground/5 text-muted-foreground"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                reg ? "bg-primary" : "bg-muted-foreground/50"
                              }`}
                            />
                            {reg ? "ลงแล้ว" : "ยังไม่ลง"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              แสดง {rows.length} จาก {total} รายชื่อ
            </p>
          </>
        )}
      </div>

      <div className="flex justify-center pt-2">
        <ScopedResetButton
          label="ล้างรายชื่อรุ่น (roster)"
          title="ล้างรายชื่อรุ่น?"
          message="รายชื่อรุ่นที่นำเข้าทั้งหมดจะถูกลบ ผู้ลงทะเบียนยังอยู่ในระบบแต่จะขึ้น “นอกรายชื่อ” ทั้งหมด กู้คืนไม่ได้"
          confirmLabel="ล้างรายชื่อรุ่น"
          busy={busy}
          onConfirm={async () => {
            await onReset();
            await load();
          }}
        />
      </div>
    </div>
  );
}

function AdminView({
  state,
  busy,
  adminKey,
  onExit,
  onSaveWards,
  onDeleteParticipant,
  onRun,
  onReset,
  onSaveSettings,
  onSetRegistrationOpen,
  onSaveRoster,
  notify,
}: {
  state: State;
  busy: boolean;
  adminKey: string;
  onExit: () => void;
  onSaveWards: (wards: Ward[]) => Promise<unknown>;
  onDeleteParticipant: (code: string) => Promise<unknown>;
  onRun: () => Promise<unknown>;
  onReset: (scope: "participants" | "runs" | "wards" | "roster") => Promise<unknown>;
  onSaveSettings: (term: string, year: string, title: string) => Promise<unknown>;
  onSetRegistrationOpen: (open: boolean) => Promise<unknown>;
  onSaveRoster: (roster: RosterEntry[]) => Promise<unknown>;
  notify: (msg: string, type?: "ok" | "err") => void;
}) {
  const [tab, setTab] = useState<"wards" | "list" | "roster" | "results" | "history">("results");

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
          {/* 5 tabs กว้างเกิน max-w-md → scroll แนวนอน (ปุ่มกว้างตามข้อความ ไม่ต้องย่อตัวอักษร) */}
          <nav className="mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-card p-1 shadow-[var(--shadow-soft)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[
              { k: "results", label: "จัดสรร / ผล" },
              { k: "list", label: `ผู้ลงทะเบียน (${state.participants.length})` },
              { k: "roster", label: "รายชื่อ" },
              { k: "wards", label: `วอร์ด (${state.wards.length})` },
              { k: "history", label: "ประวัติ" },
            ].map((t) => {
              const active = tab === t.k;
              return (
                <button
                  key={t.k}
                  onClick={(e) => {
                    setTab(t.k as typeof tab);
                    // เลื่อน tab ที่กดเข้ามากลางจอ (บนมือถือ tab ท้ายๆ อยู่นอกจอ)
                    e.currentTarget.scrollIntoView({
                      behavior: "smooth",
                      inline: "center",
                      block: "nearest",
                    });
                  }}
                  className={`relative shrink-0 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold ${
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
                <WardsAdmin
                  wards={state.wards}
                  onSave={onSaveWards}
                  busy={busy}
                  adminKey={adminKey}
                  notify={notify}
                />
                <div className="flex flex-col items-center gap-3 pt-2">
                  <ScopedResetButton
                    label="รีเซ็ตวอร์ดเป็นค่าเริ่มต้น"
                    title="รีเซ็ตวอร์ดเป็นค่าเริ่มต้น?"
                    message="วอร์ดทั้งหมดจะกลับเป็นค่าเริ่มต้น การจัดอันดับของผู้ใช้จะถูกล้าง ผลจัดสรรที่อ้างวอร์ดเดิมจะเหลือไม่มีวอร์ด กู้คืนไม่ได้"
                    confirmLabel="รีเซ็ตวอร์ด"
                    busy={busy}
                    onConfirm={() => onReset("wards")}
                  />
                </div>
              </div>
            )}
            {tab === "list" && (
              <div className="space-y-3">
                <OffRosterSummary participants={state.participants} />
                <ListPanel
                  state={state}
                  meCode=""
                  meRid=""
                  isAdmin
                  onDeleteParticipant={onDeleteParticipant}
                />
                <div className="flex justify-center pt-2">
                  <ScopedResetButton
                    label="ลบผู้ลงทะเบียนทั้งหมด"
                    title="ลบผู้ลงทะเบียนทั้งหมด?"
                    message="รายชื่อผู้ลงทะเบียน การจัดอันดับ และผลการจัดสรรที่ผูกอยู่จะถูกลบทั้งหมด กู้คืนไม่ได้"
                    confirmLabel="ลบทั้งหมด"
                    busy={busy}
                    onConfirm={() => onReset("participants")}
                  />
                </div>
              </div>
            )}
            {tab === "results" && (
              <div className="space-y-3">
                <RegistrationToggle
                  open={state.registrationOpen}
                  onToggle={onSetRegistrationOpen}
                  busy={busy}
                />
                <ResultsPanel state={state} onRun={onRun} busy={busy} />
                <div className="flex justify-center pt-2">
                  <ScopedResetButton
                    label="ล้างผลการจัดสรรทั้งหมด"
                    title="ล้างผลการจัดสรร?"
                    message="ผลการจัดสรรและประวัติการสุ่มทั้งหมดจะถูกลบ รายชื่อผู้ลงทะเบียนและอันดับของแต่ละคนยังอยู่ กู้คืนไม่ได้"
                    confirmLabel="ล้างผล"
                    busy={busy}
                    onConfirm={() => onReset("runs")}
                  />
                </div>
              </div>
            )}
            {tab === "roster" && (
              <RosterPanel
                adminKey={adminKey}
                participants={state.participants}
                onSave={onSaveRoster}
                onReset={() => onReset("roster")}
                busy={busy}
              />
            )}
            {tab === "history" && <RunsHistory adminKey={adminKey} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ปุ่ม link ขนาดเล็ก + ConfirmModal ของตัวเอง (จัด state open/close เอง)
function ScopedResetButton({
  label,
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
}: {
  label: string;
  title: string;
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-destructive"
      >
        {label}
      </button>
      {open && (
        <ConfirmModal
          title={title}
          message={message}
          confirmLabel={confirmLabel}
          busy={busy}
          onConfirm={async () => {
            await onConfirm();
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
