// One-off: apply schema.sql to Neon. Run: node scripts/init-db.mjs
import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "node:fs";

function loadEnv() {
  const p = new URL("../.env", import.meta.url);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const sql = neon(url);
const raw = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

// split into statements on ';', strip comments/blanks
const stmts = raw
  .split(/;\s*\n/)
  .map((s) => s.replace(/--[^\n]*\n/g, "").trim())
  .filter((s) => s.length > 0);

for (const stmt of stmts) {
  try {
    await sql.query(stmt);
    const head = stmt.replace(/\s+/g, " ").slice(0, 60);
    console.log("ok:", head);
  } catch (e) {
    console.error("FAIL:", e.message, "| stmt:", stmt.slice(0, 80));
  }
}
console.log("done:", stmts.length, "statements");
