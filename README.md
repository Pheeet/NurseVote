# NurseVote — ลงทะเบียน / จัดวอร์ดพยาบาล (Admission)

เว็บแอปสำหรับให้นักศึกษาพยาบาลลงทะเบียนและจัดอันดับวอร์ด (ward) ที่ต้องการ แล้วระบบสุ่มจัดสรรตามอันดับแบบ admission (random order + เติมตามลำดับที่เลือก จนกว่าความจุของวอร์ดจะเต็ม).

ข้อมูลเก็บใน **Neon (Postgres)** — ทุกคนใช้ข้อมูลร่วมกันแบบ real-time (ไม่ใช่ localStorage แยกเครื่อง).

## ✨ ฟีเจอร์

- **ผู้ใช้ (User)** — ลงทะเบียนด้วยรหัสนักศึกษา 9 หลัก + จัดอันดับวอร์ดทั้งหมด แก้ไข/ลบตัวเองได้
- **รายชื่อ** — ดู/ค้นหาคนที่สมัครแล้ว
- **วอร์ด** — ดูวอร์ดและความจุ
- **ผลการจัดสรร** — สถิติอันดับที่ได้ + รายชื่อคนในแต่ละวอร์ด
- **แอดมิน (ซ่อน)** — เข้าผ่านการ tap หัวเรื่อง 5 ครั้ง → login ด้วยรหัสผ่าน → จัดการวอร์ด/รายชื่อ, กดสุ่ม, ล้างข้อมูล, ตั้งค่าภาค/ปีการศึกษา

## 🧱 Tech stack

| ชั้น | เทคโนโลยี |
|---|---|
| Frontend | React 18 + Vite + TanStack Router + Tailwind CSS v4 + framer-motion |
| Backend | Vercel Functions (`/api`) |
| Database | Neon (Postgres) + `@neondatabase/serverless` |
| Deploy | Vercel |

## 📂 โครงสร้าง

```
api/
  _lib.ts            # db client + ทุก query + business logic
  state.ts           # GET  /api/state
  participant.ts     # GET(exists) / PUT / DELETE  /api/participant
  wards.ts           # PUT  /api/wards
  run.ts             # POST /api/run
  reset.ts           # POST /api/reset
  settings.ts        # PUT  /api/settings
src/
  routes/index.tsx   # ทั้งแอป (User + Admin + API client)
  index.css          # theme tokens + animations
scripts/
  serve-api.ts       # dev API server (mirror ตัวจริง, ไม่ต้อง login Vercel)
  init-db.mjs        # apply schema.sql ลง Neon
  test-api.ts        # smoke test DB logic
schema.sql           # schema ฐานข้อมูล
vercel.json          # SPA rewrite + framework
```

## 🗄️ โครงสร้างฐานข้อมูล

ตาราง: `wards`, `participants`(PK=รหัส 9 หลัก), `choices`(อันดับที่เลือก), `runs`(รอบสุ่ม), `assignments`(ผล), `settings`(key-value เช่น ภาค/ปี) + view `latest_assignments`.

ลบ participant → cascade ลบ choices อัตโนมัติ. ลบ ward → assignments ที่อ้างถึง set เป็น NULL.

ดู `schema.sql`.

## 🚀 เริ่มต้น

### 1. dependencies
```bash
npm install
```

### 2. ตั้ง env
สร้าง Neon project → copy connection string → ใส่ใน `.env`:
```
DATABASE_URL=postgresql://USER:PASS@ep-xxx.neon.tech/dbname?sslmode=require
ADMIN_KEY=<สุ่มยาว ≥ 32 อักขระ>
# ROW_ID_SALT=<optional, salt สำหรับ opaque row id — default ใช้ ADMIN_KEY>
```

`ADMIN_KEY` เป็นรหัสผู้ดูแลระบบ (server ตรวจผ่าน header `x-admin-key` แบบ constant-time). สร้างค่าสุ่มด้วย:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

### 3. apply schema
```bash
npm run db:init
```

### 4. run dev
```bash
npm run dev
```
เปิด http://localhost:5173 (api รันบน :5180 พร้อม proxy — **ไม่ต้อง login Vercel**).

> ทางเลือก: `vercel dev` (ต้อง `vercel login` ก่อน).

## 📦 scripts

| คำสั่ง | ทำงาน |
|---|---|
| `npm run dev` | web + api พร้อมกัน |
| `npm run build` | production build |
| `npm run db:init` | apply `schema.sql` ลง Neon |
| `npm run db:test` | smoke test DB logic |
| `npm run typecheck` | `tsc` |

## ☁️ Deploy บน Vercel

1. import repo จาก GitHub (framework = Vite อัตโนมัติ)
2. **Settings → Environment Variables** → เพิ่ม `DATABASE_URL` และ `ADMIN_KEY` (ค่าเดียวกับ `.env`)
3. deploy — `api/` functions กับ vite build ใช้ได้เลย

## 🔐 Security notes

- `DATABASE_URL` + `ADMIN_KEY` เป็น credential — อยู่ใน `.env` (gitignore แล้ว) **ห้าม commit**
- ทางเข้าแอดมิน = tap หัวเรื่อง 5 ครั้ง (เป็นแค่การซ่อน UI ไม่ใช่ security) → รหัสจริงคือ **`ADMIN_KEY`** ที่ server ตรวจฝั่ง backend ทุก request. ตั้งให้สุ่มยาว ≥ 32 อักขระ. ถ้าสงสัยว่ารั่ว → เปลี่ยนค่าใน `.env` + Vercel env (การเปลี่ยน `ADMIN_KEY` จะรีเซ็ต opaque row id ด้วยถ้าไม่ได้ตั้ง `ROW_ID_SALT` แยก — ผู้ใช้จะต้อง "ดึงข้อมูลเดิม" ใหม่ครั้งเดียว)
- ถ้า connection string รั่ว → Neon → **Reset password** แล้วเปลี่ยนทั้ง `.env` และ Vercel env
- **PII / รหัสนักศึกษา** — `/api/state` เปิด public แต่ mask รหัสเหลือ 3 หลักท้าย (เช่น `••••••789`); รหัสเต็มเห็นได้เฉพาะ admin (แนบ `x-admin-key`) เท่านั้น
- **Rate limiting (brute-force `ADMIN_KEY`)** — serverless in-memory limiter ไม่เสถียร จึงใช้ **Vercel WAF** แทน: Project → **Firewall → Rate Limiting** → เพิ่ม rule จำกัด req/IP (เช่น 20 req/min) บน path `/api/run`, `/api/participant`, `/api/wards`, `/api/settings`, `/api/reset`. คู่กับ `ADMIN_KEY` ที่สุ่มยาวก็เพียงพอ
- **Security headers** — ตั้งใน `vercel.json` (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, CSP, และ `Cache-Control: no-store` บน `/api/*`)
- **Input limits** — API cap ขนาด payload (~64KB), จำนวน choices/wards, และ validate ชนิดข้อมูล กัน DoS/insert เกิน

## ⚡ Performance / Scaling (รองรับ ~500 concurrent)

- **`/api/state` = 1 Neon round-trip** — รวมทุกตาราง (wards/participants/choices/assignments/settings) เป็น query เดียวด้วย `json_agg`/`json_build_object` (เดิม 6 query) ลดโหลด DB ตอน concurrent สูง ~6×
- **CDN cache** — public `/api/state` (masked, ไม่มี PII) ตั้ง `Cache-Control: public, s-maxage=3, stale-while-revalidate=30` → Vercel edge เสิร์ฟแทน DB ระหว่าง window. admin และ client หลังกดบันทึกแนบ `?t=<ts>` unique เพื่อ bypass cache = เห็นข้อมูลสดทันที (ไม่มี cache poisoning เพราะ response ที่มีรหัสเต็มมี URL unique + `no-store` เสมอ)
- **Fluid Compute** (Vercel default) กระจาย request ไปหลาย instance — cold burst 500 คน = แต่ละ instance ยิง Neon 1 call, ไม่ใช่ pool เดียว
- Static assets (JS ~122KB gzip) เสิร์ฟผ่าน CDN — ไม่ใช่คอขวด
- Load test (dev, single process): 500 concurrent GET `/api/state` valid ~97%, mixed 500 reads+20 writes = 100%. prod กระจาย instance + CDN จะดีกว่านี้
