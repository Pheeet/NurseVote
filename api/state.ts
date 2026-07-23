import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getState, json, fail, isAdminReq } from "./_lib.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const admin = isAdminReq(req);
    // public state ถูก mask แล้ว (ไม่มี PII) → cache ที่ CDN สั้นๆ เพื่อรองรับ concurrent สูง
    // admin เห็นรหัสเต็ม → ห้าม cache. client admin/หลังบันทึก แนบ ?t=<ts> unique ทำให้ได้ข้อมูลสดเสมอ
    res.setHeader(
      "Cache-Control",
      admin ? "private, no-store" : "public, s-maxage=3, stale-while-revalidate=30",
    );
    return json(res, await getState({ admin }));
  } catch (e: any) {
    return fail(res, e);
  }
}
