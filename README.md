# NurseVote — ลงทะเบียน / จัดหวอดพยาบาล (Admission)

เว็บแอปสำหรับให้นักศึกษาพยาบาลลงทะเบียนและจัดอันดับหวอด (ward) ที่ต้องการ แล้วระบบสุ่มจัดสรรตามอันดับแบบ admission (random order + เติมตามลำดับที่เลือก จนกว่าความจุของหวอดจะเต็ม).

ข้อมูลเก็บใน **Neon (Postgres)** — ทุกคนใช้ข้อมูลร่วมกันแบบ real-time (ไม่ใช่ localStorage แยกเครื่อง).

## ✨ ฟีเจอร์

- **ผู้ใช้ (User)** — ลงทะเบียนด้วยรหัสนักศึกษา 9 หลัก + จัดอันดับหวอดทั้งหมด แก้ไข/ลบตัวเองได้
- **รายชื่อ** — ดู/ค้นหาคนที่สมัครแล้ว
- **หวอด** — ดูหวอดและความจุ
- **ผลการจัดสรร** — สถิติอันดับที่ได้ + รายชื่อคนในแต่ละหวอด
- **แอดมิน (ซ่อน)** — เข้าผ่านการ tap หัวเรื่อง 5 ครั้ง → login ด้วยรหัสผ่าน → จัดการหวอด/รายชื่อ, กดสุ่ม, ล้างข้อมูล, ตั้งค่าภาค/ปีการศึกษา

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
  participant.ts     # PUT/DELETE  /api/participant
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

### 2. ตั้ง `DATABASE_URL`
สร้าง Neon project → copy connection string → ใส่ใน `.env`:
```
DATABASE_URL=postgresql://USER:PASS@ep-xxx.neon.tech/dbname?sslmode=require
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
2. **Settings → Environment Variables** → เพิ่ม `DATABASE_URL` (ค่าเดียวกับ `.env`)
3. deploy — `api/` functions กับ vite build ใช้ได้เลย

## 🔐 Security notes

- `DATABASE_URL` เป็น credential — อยู่ใน `.env` (gitignore แล้ว) **ห้าม commit**
- ทางเข้าแอดมิน = tap หัวเรื่อง 5 ครั้ง + รหัสผ่าน (ตั้งใน `src/routes/index.tsx`, `ADMIN_PASSWORD`)
- ถ้า connection string รั่ว → Neon → **Reset password** แล้วเปลี่ยนทั้ง `.env` และ Vercel env
