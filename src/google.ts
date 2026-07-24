// Google Identity Services (GIS) wrapper — One Tap + fallback button
// สคริปต์ https://accounts.google.com/gsi/client โหลดจาก index.html (ต้องเปิดใน CSP)
// ผูก Ownership กับ Google account (ดู docs/adr/0001) — ID token (JWT) แนบทุก request ให้ server verify

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const TOKEN_KEY = "nurse-google-idtoken";

type CredentialResponse = { credential?: string };
type GoogleId = {
  initialize: (cfg: Record<string, unknown>) => void;
  prompt: (cb?: (n: unknown) => void) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
  disableAutoSelect: () => void;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

export const googleEnabled = () => !!CLIENT_ID;

// exp (ms) ของ ID token — decode payload เฉยๆ ไม่ verify (ใช้แค่เช็คหมดอายุฝั่ง client)
export function tokenExp(token: string): number {
  try {
    const b = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const p = JSON.parse(atob(b));
    return typeof p.exp === "number" ? p.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function loadStoredToken(): string | null {
  const t = localStorage.getItem(TOKEN_KEY);
  if (t && tokenExp(t) > Date.now() + 30_000) return t; // เหลืออายุ > 30s จึงใช้
  if (t) localStorage.removeItem(TOKEN_KEY);
  return null;
}
function storeToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearStoredToken() {
  localStorage.removeItem(TOKEN_KEY);
  window.google?.accounts?.id?.disableAutoSelect();
}

// รอให้สคริปต์ GIS พร้อม (index.html โหลดแบบ async)
function waitForGis(timeoutMs = 8000): Promise<GoogleId | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const id = window.google?.accounts?.id;
      if (id) return resolve(id);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 100);
    };
    tick();
  });
}

let initialized = false;
let onTokenCb: ((token: string) => void) | null = null;

// init GIS + One Tap (auto_select เด้งเองถ้า login อยู่แล้วและเคยยินยอม)
export async function initGoogle(onToken: (token: string) => void): Promise<boolean> {
  onTokenCb = onToken;
  if (!CLIENT_ID) return false;
  const id = await waitForGis();
  if (!id) return false;
  if (!initialized) {
    id.initialize({
      client_id: CLIENT_ID,
      auto_select: true,
      cancel_on_tap_outside: false,
      callback: (resp: CredentialResponse) => {
        if (resp.credential) {
          storeToken(resp.credential);
          onTokenCb?.(resp.credential);
        }
      },
    });
    initialized = true;
  }
  return true;
}

// เด้ง One Tap (ทางหลัก) — เงียบถ้าไม่ได้ login Google หรือถูก cooldown
export async function promptOneTap() {
  const id = await waitForGis();
  id?.prompt();
}

// ปุ่มสำรอง (safety net เผื่อ One Tap ไม่เด้ง: ปิดทิ้ง/cooldown/Safari)
export async function renderGoogleButton(el: HTMLElement) {
  const id = await waitForGis();
  id?.renderButton(el, { theme: "outline", size: "large", shape: "pill", text: "signin_with", width: 260 });
}
