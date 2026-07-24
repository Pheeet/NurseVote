# NurseVote

ระบบให้นักศึกษาพยาบาลลงทะเบียนและจัดอันดับวอร์ดที่ต้องการฝึกงาน แล้วจัดสรรวอร์ดให้แบบ admission
(สุ่มลำดับคน → เติมตามอันดับที่แต่ละคนเลือก จนวอร์ดเต็ม)

## Language

### การลงทะเบียน

**Participant**:
นักศึกษาที่ลงทะเบียนเข้าระบบแล้วและได้จัดอันดับวอร์ดไว้ครบ
_Avoid_: User, Student, ผู้ใช้ — "User" หมายถึงคนที่เปิดเว็บ ซึ่งอาจยังไม่เป็น Participant

**Student Code**:
รหัสนักศึกษา 9 หลัก เป็นตัวระบุ Participant ที่ออกโดยสถาบัน **ไม่ใช่ความลับ** — ปรากฏบนเอกสารและรายชื่อทั่วไป
_Avoid_: Student ID, รหัส, code เปล่าๆ

**Identity**:
Google account ที่ Participant ใช้ยืนยันตัวตน หนึ่ง Identity ผูกได้กับหนึ่ง Participant เท่านั้น และกลับกัน
_Avoid_: Account, Login, User account

**Ownership**:
สิทธิ์แก้ไขและลบข้อมูลลงทะเบียนของ Participant หนึ่งราย เกิดจากการที่ Identity ผูกกับ Participant นั้น
_Avoid_: Permission, Access, สิทธิ์เปล่าๆ

**Roster**:
รายชื่อนักศึกษาทั้งรุ่น (Student Code + ชื่อ) ที่ Admin นำเข้าไว้ล่วงหน้า ใช้เป็นข้อมูลอ้างอิงว่ารหัสไหน "ควร" มีอยู่จริง
_Avoid_: Whitelist, Allowlist, รายชื่อ — Roster **ไม่ได้** บล็อกคนนอกรายชื่อ (ดู Off-roster)

**Off-roster Registration**:
การลงทะเบียนด้วย Student Code ที่ไม่ปรากฏใน Roster ระบบยอมรับแต่ทำเครื่องหมายไว้ให้ Admin ตรวจ
_Avoid_: Invalid registration, Rejected — มันไม่ถูกปฏิเสธ

**Squatting** (สวมรอย):
การที่คนหนึ่งลงทะเบียนด้วย Student Code ของอีกคน ทำให้เจ้าของรหัสตัวจริงลงทะเบียนไม่ได้
_Avoid_: Impersonation, Fraud, Hijacking — Hijacking คือแย่งของที่ลงทะเบียนไปแล้ว ซึ่งเป็นคนละเรื่อง

### การจัดสรร

**Registration Window**:
ช่วงเวลาที่ Participant สร้างและแก้ไขข้อมูลตัวเองได้ Admin เป็นคนเปิดและปิด
ปิดแล้ว Choice ถูกแช่แข็ง สั่ง Run ซ้ำกี่รอบก็ได้ผลจาก input ชุดเดิม
_Avoid_: Deadline, Cutoff — Admin เปิดกลับได้ ไม่ใช่เวลาตายตัว

**Ward**:
หน่วยงานที่รับนักศึกษาไปฝึก แต่ละ Ward มี Capacity จำกัด

**Capacity**:
จำนวน Participant สูงสุดที่ Ward หนึ่งรับได้

**Choice**:
Ward หนึ่งที่ Participant เลือกไว้ที่อันดับหนึ่งๆ Participant ต้องจัดอันดับ Ward ให้ครบทุกอัน ห้ามซ้ำ
_Avoid_: Preference, Vote, Selection — "Vote" ทำให้เข้าใจผิดว่าเป็นการโหวตรวม ทั้งที่เป็นการเลือกของแต่ละคน

**Run**:
รอบการจัดสรรหนึ่งครั้งที่ Admin สั่ง แต่ละ Run ให้ผลใหม่ทั้งชุด Run ล่าสุดคือผลที่มีผลจริง
_Avoid_: Draw, Lottery, การสุ่ม

**Assignment**:
ผลของ Run หนึ่ง สำหรับ Participant หนึ่งราย — ได้ Ward ไหน ที่อันดับเท่าไหร่ (หรือไม่ได้เลย)
_Avoid_: Result, Allocation

**Admin**:
ผู้ดูแลที่แก้ไขข้อมูลของใครก็ได้ สั่ง Run และจัดการ Ward ยืนยันตัวตนด้วย ADMIN_KEY ไม่ใช่ Identity

## Flagged ambiguities

**"สวมรอย" ครอบคลุมสองเรื่องที่ต่างกันมาก** — แยกให้ชัดเสมอ:
- **Squatting** — ลงทะเบียนตัดหน้าด้วยรหัสคนอื่น กันไม่ได้ 100% เพราะ Student Code ไม่ใช่ความลับ
  เป้าหมายคือตรวจจับได้ ย้อนกลับได้ และสาวถึง Identity ที่ทำได้
- **Hijacking** — แย่ง Ownership ของ Participant ที่ลงทะเบียนไปแล้ว กันได้สนิทด้วยการผูก Identity

## Example dialogue

> **Dev:** ถ้ามีคนกรอกรหัสเพื่อนแล้วลงทะเบียนก่อน เราบล็อกได้มั้ย
>
> **Domain expert:** บล็อกไม่ได้ Student Code ไม่ใช่ความลับ อยู่บนรายชื่อติดบอร์ดด้วยซ้ำ
> สิ่งที่ทำได้คือรู้ว่าใครทำ เพราะทุกการลงทะเบียนต้องผูก Identity
>
> **Dev:** แล้ว Roster ล่ะ ถ้ารหัสไม่อยู่ใน Roster ก็ปฏิเสธไปเลยสิ
>
> **Domain expert:** ไม่ ถ้า Roster ตกหล่นคนนึง คนนั้นจะลงทะเบียนไม่ได้เลยทั้งที่ไม่ผิดอะไร
> ให้ผ่านไปก่อนแล้วมาร์คเป็น Off-roster Registration ให้ Admin ไล่ดู
>
> **Dev:** ถ้าเจอว่าเป็น Squatting จริง Admin ทำอะไรได้
>
> **Domain expert:** ตัด Ownership ของ Identity นั้นออก แล้วให้เจ้าของตัวจริง login มาผูกใหม่
> ข้อมูล Choice ที่คนสวมรอยกรอกไว้ก็ล้างทิ้ง
>
> **Dev:** ต้องทำก่อน Run มั้ย
>
> **Domain expert:** ต้อง Assignment ผูกกับ Participant ถ้า Run ไปแล้วค่อยมาแก้ Ownership
> คนสวมรอยจะได้ Ward ที่เขาเลือก ไม่ใช่ที่เจ้าของตัวจริงอยากได้ ต้อง Run ใหม่ทั้งชุด
