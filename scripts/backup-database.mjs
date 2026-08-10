import path from "node:path";
import { backupDatabase, databasePath } from "../server/database.mjs";
import { resolveDataPaths } from "../server/runtime-config.mjs";

const { dataDirectory } = resolveDataPaths();
const backupDirectory = path.resolve(process.env.PRIXRADAR_BACKUP_DIR || path.join(dataDirectory, "backups"));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.join(backupDirectory, `radarprix-${timestamp}.sqlite.db`);

if (path.resolve(destination) === path.resolve(databasePath)) {
  throw new Error("Backup destination must differ from the live database path");
}
await backupDatabase(destination);
console.log(`SQLite backup created: ${destination}`);
