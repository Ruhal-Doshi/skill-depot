import { ensureGlobalDirs, ensureProjectDirs, getGlobalPaths, getProjectPaths } from "../core/storage.js";
import { createDatabase, deleteSkill, getSkillByName } from "../core/database.js";
import { deleteSkillFile } from "../core/file-manager.js";
import * as log from "../utils/logger.js";

export async function removeCommand(name: string): Promise<void> {
    const projectRoot = process.cwd();
    const globalPaths = await ensureGlobalDirs();
    const globalDb = createDatabase(globalPaths.globalDbPath);

    let projectDb;
    try {
        const projectPaths = await ensureProjectDirs(projectRoot);
        projectDb = createDatabase(projectPaths.projectDbPath);
    } catch {
        projectDb = null;
    }

    try {
        // Check project first, then global
        const projectRecord = projectDb ? getSkillByName(projectDb, name) : null;
        const globalRecord = getSkillByName(globalDb, name);
        const record = projectRecord || globalRecord;
        const db = projectRecord ? projectDb! : globalDb;

        if (!record) {
            log.error(`Skill "${name}" not found`);
            return;
        }

        // Delete file and DB record
        await deleteSkillFile(record.file_path);
        deleteSkill(db, name);

        log.success(`Removed: ${name} [${record.scope}]`);
    } finally {
        globalDb.close();
        projectDb?.close();
    }
}
