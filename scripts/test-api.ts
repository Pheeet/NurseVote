import { readFileSync, existsSync } from "node:fs";
import {
  getState,
  saveParticipant,
  removeParticipant,
  runAdmission,
  resetAll,
} from "../api/_lib.ts";

const p = new URL("../.env", import.meta.url);
if (existsSync(p))
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].trim();
  }

const wards6 = ["w1", "w2", "w3", "w4", "w5", "w6"];

console.log("== init state ==");
const s0 = await getState();
console.log("wards:", s0.wards.length, "participants:", s0.participants.length);

console.log("== register 2 ==");
await saveParticipant("111111111", "ทดสอบ ก", wards6, { admin: true });
await saveParticipant("222222222", "ทดสอบ ข", ["w2", "w1", "w3", "w4", "w5", "w6"], { admin: true });
const s1 = await getState();
console.log("participants:", s1.participants.length);
console.log("p1 choices:", JSON.stringify(s1.participants[0]?.choices));

console.log("== run ==");
const r = await runAdmission();
console.log("assignments:", r.assignments.length);
for (const a of r.assignments) console.log("  ", a.code, "->", a.wardId, "rank", a.rank);

console.log("== state after run ==");
const s2 = await getState();
console.log("assignments:", s2.assignments?.length, "runAt:", s2.runAt);

console.log("== delete + reset ==");
await removeParticipant("111111111", { admin: true });
await resetAll();
const s3 = await getState();
console.log("after reset wards:", s3.wards.length, "participants:", s3.participants.length, "assignments:", s3.assignments);
console.log("ALL OK");
