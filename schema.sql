-- ============================================================
--  VoteNurse / สุ่มหวอดพยาบาล — Neon schema
--  Run once in Neon SQL editor (or psql / vercel env pull + push)
-- ============================================================

-- หวอด (เช่น หวอด 1..6) แต่ละหวอดมีความจุ
CREATE TABLE IF NOT EXISTS wards (
  id        text PRIMARY KEY,                 -- 'w1','w2',...
  name      text NOT NULL,                    -- 'หวอด 1'
  capacity  integer NOT NULL DEFAULT 5 CHECK (capacity >= 0),
  pos       integer NOT NULL DEFAULT 0        -- ลำดับแสดงผล
);

-- ผู้สมัคร (PK = รหัสนักศึกษา 9 หลัก)
CREATE TABLE IF NOT EXISTS participants (
  code       text PRIMARY KEY,                -- '123456789'
  name       text NOT NULL,
  token      text NOT NULL DEFAULT '',        -- hash ของ ownership token (แก้ไข/ลบตัวเอง)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate: เพิ่มคอลัมน์ token สำหรับ DB เก่า
ALTER TABLE participants ADD COLUMN IF NOT EXISTS token text NOT NULL DEFAULT '';

-- การจัดอันดับหวอดของแต่ละคน (admission choices)
CREATE TABLE IF NOT EXISTS choices (
  participant_code text NOT NULL REFERENCES participants(code) ON DELETE CASCADE,
  rank             integer NOT NULL CHECK (rank >= 1),
  ward_id          text NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  PRIMARY KEY (participant_code, rank),
  UNIQUE (participant_code, ward_id)          -- ห้ามจัดหวอดเดียวซ้ำ
);

-- แต่ละรอบการสุ่ม (admin กดสุ่ม = insert รอบใหม่)
CREATE TABLE IF NOT EXISTS runs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ผลการสุ่มของรอบนั้น (ward_id NULL = ไม่ได้หวอด)
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

-- ค่าเริ่มต้นของภาค/ปีการศึกษา (ถ้ายังไม่มี)
INSERT INTO settings (key, value) VALUES
  ('term', '2'),
  ('year', '2569')
ON CONFLICT (key) DO NOTHING;

-- ---- seed หวอดเริ่มต้น (ถ้ายังว่าง) ----
INSERT INTO wards (id, name, capacity, pos) VALUES
  ('w1','หวอด 1',5,1),
  ('w2','หวอด 2',5,2),
  ('w3','หวอด 3',5,3),
  ('w4','หวอด 4',5,4),
  ('w5','หวอด 5',5,5),
  ('w6','หวอด 6',5,6)
ON CONFLICT (id) DO NOTHING;
