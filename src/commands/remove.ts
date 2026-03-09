import { ensureGlobalDirs, ensureProjectDirs, getGlobalPaths, getProjectPaths } from "../core/storage.js";
import { createDatabase, deleteSkill, getSkillByName } from "../core/database.js";
import { deleteSkillFile } from "../core/file-manager.js";
import * as log from "../utils/logger.js";

export async function removeCommand(name: string): Promise<void> {
    const projectRoot = process.cwd();
    const globalPaths = await ensureGlobalDirs();
    const globalDb = createDatabase(globalPaths.globalDbPath);

    const record = getSkillByName(globalDb, name);
    const db = globalDb;

    if (!record) {
        log.error(`Skill "${name}" not found`);
        return;
    }

    // Delete file and DB record
    await deleteSkillFile(record.file_path);
    deleteSkill(db, name);

    log.success(`Removed: ${name} [${record.scope}]`);
    globalDb.close();
}
