-- ============================================================
--  VoteNurse / สุ่มวอร์ดพยาบาล — Neon schema
--  Run once in Neon SQL editor (or psql / vercel env pull + push)
-- ============================================================

-- วอร์ด (เช่น วอร์ด 1..6) แต่ละวอร์ดมีความจุ
CREATE TABLE IF NOT EXISTS wards (
  id        text PRIMARY KEY,                 -- 'w1','w2',...
  name      text NOT NULL,                    -- 'วอร์ด 1'
  capacity  integer NOT NULL DEFAULT 5 CHECK (capacity >= 0),
  pos       integer NOT NULL DEFAULT 0        -- ลำดับแสดงผล
);

-- Roster: รายชื่อทั้งรุ่นที่ admin นำเข้าล่วงหน้า (Student Code + ชื่อ)
-- เป็นข้อมูล "อ้างอิง" เท่านั้น — ไม่บล็อกคนนอกรายชื่อ (soft roster, ดู docs/adr/0002)
-- import roster ไม่สร้าง participant: roster กับ participants แยกกันเด็ดขาด
CREATE TABLE IF NOT EXISTS roster (
  code text PRIMARY KEY,                       -- '123456789'
  name text NOT NULL
);

-- ผู้สมัคร (PK = รหัสนักศึกษา 9 หลัก)
-- Ownership ผูกกับ Google Identity (google_sub) ทางเดียว — ทุก record ต้องมี google_sub
-- (ยกเว้น record ที่ admin สร้างแทน ซึ่งมี admin เป็นเจ้าของ). ดู docs/adr/0001
CREATE TABLE IF NOT EXISTS participants (
  code       text PRIMARY KEY,                 -- '123456789'
  name       text NOT NULL,
  google_sub text,                             -- Google 'sub' claim: 1 บัญชี = 1 รหัส (unique index ด้านล่าง)
  email      text,                             -- ให้ admin ระบุตัวคนเท่านั้น (ไม่ขึ้น public state)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate DB เก่า: เพิ่มคอลัมน์ identity, ทิ้ง token model เดิม
-- UNIQUE index (ไม่ใช่ constraint) เพราะ Postgres มอง NULL หลายตัวเป็นคนละค่า
-- → record ที่ admin สร้างแทน (google_sub NULL) อยู่ร่วมกันได้
ALTER TABLE participants ADD COLUMN IF NOT EXISTS google_sub text;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS email text;
CREATE UNIQUE INDEX IF NOT EXISTS participants_google_sub_key ON participants (google_sub);
ALTER TABLE participants DROP COLUMN IF EXISTS token;
ALTER TABLE participants DROP COLUMN IF EXISTS pin;

-- การจัดอันดับวอร์ดของแต่ละคน (admission choices)
CREATE TABLE IF NOT EXISTS choices (
  participant_code text NOT NULL REFERENCES participants(code) ON DELETE CASCADE,
  rank             integer NOT NULL CHECK (rank >= 1),
  ward_id          text NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  PRIMARY KEY (participant_code, rank),
  UNIQUE (participant_code, ward_id)          -- ห้ามจัดวอร์ดเดียวซ้ำ
);

-- แต่ละรอบการสุ่ม (admin กดสุ่ม = insert รอบใหม่)
CREATE TABLE IF NOT EXISTS runs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ผลการสุ่มของรอบนั้น (ward_id NULL = ไม่ได้วอร์ด)
CREATE TABLE IF NOT EXISTS assignments (
  run_id           bigint NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  participant_code text NOT NULL REFERENCES participants(code) ON DELETE CASCADE,
  ward_id          text REFERENCES wards(id) ON DELETE SET NULL,
  rank             integer,                    -- อันดับที่ได้ (null ถ้าไม่ได้)
  PRIMARY KEY (run_id, participant_code)
);

-- มุมมองสะดวก: ผลของรอบล่าสุดเท่านั้น
CREATE OR REPLACE VIEW latest_assignments AS
SELECT a.participant_code, a.ward_id, a.rank, r.created_at AS run_at
FROM assignments a
JOIN runs r ON r.id = a.run_id
WHERE r.id = (SELECT max(id) FROM runs);

-- ตั้งค่าทั่วไป (key-value) เช่น ภาค/ปีการศึกษาที่แสดงบนหัวเรื่อง
CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- ค่าเริ่มต้น: ภาค/ปีการศึกษา + สถานะเปิดรับสมัคร (Registration Window)
-- registration_open = 'true'|'false' — admin ปิดเพื่อแช่แข็ง choices ก่อนสั่ง run
INSERT INTO settings (key, value) VALUES
  ('term', '2'),
  ('year', '2569'),
  ('registration_open', 'true')
ON CONFLICT (key) DO NOTHING;

-- ---- seed วอร์ดเริ่มต้น (ถ้ายังว่าง) ----
INSERT INTO wards (id, name, capacity, pos) VALUES
  ('w1','วอร์ด 1',5,1),
  ('w2','วอร์ด 2',5,2),
  ('w3','วอร์ด 3',5,3),
  ('w4','วอร์ด 4',5,4),
  ('w5','วอร์ด 5',5,5),
  ('w6','วอร์ด 6',5,6)
ON CONFLICT (id) DO NOTHING;
