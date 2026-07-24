# Google Identity เป็นหลักฐาน Ownership ทางเดียว

เดิม Ownership พิสูจน์ด้วย random token ที่เก็บใน localStorage ซึ่งหายเมื่อผู้ใช้ล้าง browser
หรือเปลี่ยนเครื่อง แล้วกู้คืนไม่ได้เลย เราเปลี่ยนไปผูก Ownership กับ Google account (Identity) แทน
โดยบังคับใช้ทางเดียว ไม่มี fallback เป็น token เดิม เพราะระบบ auth สองทางที่แข็งไม่เท่ากัน
จะแข็งเท่าทางที่อ่อนกว่าเสมอ แต่ต้องจ่ายค่า complexity สองเท่า

ตัวยืนยันคือ Google ID token (JWT) ที่ client ได้จาก Google Identity Services แล้วแนบมากับทุก request
server verify signature กับ Google JWKS ทุกครั้ง **ไม่มี session ฝั่งเรา ไม่มี cookie ไม่มี client secret**

## Considered Options

- **OAuth authorization code flow + session cookie ของตัวเอง** — ต้องมี callback route, client secret,
  logic เซ็น/ต่ออายุ session และ state ฝั่ง server ทั้งหมดนี้เพื่อแลกกับ session ที่อายุยาวกว่า 1 ชั่วโมง
  ซึ่งไม่ใช่ปัญหาจริงสำหรับงานที่ผู้ใช้เข้ามากรอกครั้งเดียวแล้วแก้นานๆ ที
- **Clerk / Auth0** — เร็วที่สุดในการ ship แต่เพิ่ม vendor และค่าใช้จ่ายถาวรให้ระบบที่ใช้งานปีละครั้ง

## Consequences

- ยังคงเป็น stateless เต็มตัว เข้ากับ Fluid Compute และ CDN cache บน `/api/state` ที่ tune ไว้แล้ว
  ถ้าเลือก session cookie จะต้องรื้อกลยุทธ์ cache ใหม่
- ไม่มี credential ใหม่ให้รั่ว — `GOOGLE_CLIENT_ID` เป็นค่าสาธารณะ
- key ที่เก็บคือ `sub` ไม่ใช่ email เพราะ email เปลี่ยนได้และถูกนำกลับมาใช้ซ้ำได้ ส่วน `sub` คงที่ตลอด
  เก็บ email ไว้ด้วยแต่ใช้เพื่อให้ Admin ระบุตัวคนเท่านั้น
- ID token อายุ ~1 ชั่วโมง หมดอายุแล้วต้องกดปุ่ม Google ใหม่ (GIS จำ session ไว้ ไม่ต้องพิมพ์อะไร)
- Google account ส่วนตัวไม่ได้พิสูจน์ว่าใครเป็นเจ้าของ Student Code จริง ADR นี้แก้เรื่อง Hijacking
  และการกู้คืน Ownership เท่านั้น **ไม่ได้แก้ Squatting** — ดู ADR 0002
- CSP ใน `vercel.json` ต้องเปิดช่องให้ Google Identity Services โดยจำกัดที่ path `gsi` เท่านั้น
  (`script-src`/`frame-src`/`connect-src` เพิ่ม `https://accounts.google.com/gsi/...`) ไม่เปิดทั้ง domain
- Authorized JavaScript origins ของ Google Client รองรับเฉพาะ origin คงที่ ไม่รับ wildcard
  จึงใช้ Vercel branch alias (URL คงที่ต่อ branch) แทน preview URL แบบสุ่มที่เปลี่ยนทุก deploy
