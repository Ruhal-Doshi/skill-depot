import { ensureGlobalDirs, ensureProjectDirs } from "../core/storage.js";
import { createDatabase } from "../core/database.js";
import { listSkills } from "../core/search.js";
import * as log from "../utils/logger.js";

export async function listCommand(scope: "all" | "global" | "project"): Promise<void> {
    const projectRoot = process.cwd();
    const globalPaths = await ensureGlobalDirs();
    const globalDb = createDatabase(globalPaths.globalDbPath);

    try {
        const skills = listSkills(globalDb, scope, projectRoot);

        if (skills.length === 0) {
            log.info("No skills indexed yet. Run 'skill-depot init' or 'skill-depot add' to get started.");
            return;
        }

        console.log();
        for (const skill of skills) {
            log.skillEntry(skill.name, skill.scope, skill.description);
        }
        console.log();
        log.info(`Total: ${skills.length} skills`);
    } finally {
        globalDb.close();
    }
}
