import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DB_PATH, DATA_DIR } from "../db";

const backupDir = path.join(DATA_DIR, "backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(backupDir, `clinic-${stamp}.db`);
const src = new DatabaseSync(DB_PATH);
src.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
src.close();
console.log(`[backup] zapisano: ${target}`);
