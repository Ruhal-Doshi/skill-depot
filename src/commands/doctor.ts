import { existsSync } from "node:fs";
import { ensureGlobalDirs, ensureProjectDirs, getGlobalPaths, getProjectPaths, isGlobalInitialized, isProjectInitialized } from "../core/storage.js";
import { createDatabase, getAllSkills, getSkillCount } from "../core/database.js";
import { isModelDownloaded } from "../core/embeddings.js";
import { fileExists } from "../core/file-manager.js";
import * as log from "../utils/logger.js";

export async function doctorCommand(): Promise<void> {
    console.log();
    console.log("  🩺 skill-depot doctor");
    console.log();

    let issues = 0;

    // ─── 1. Check global installation ────────────────────────
    if (isGlobalInitialized()) {
        log.success("Global skill-depot directory exists");
    } else {
        log.error("Global skill-depot directory not found — run 'skill-depot init'");
        issues++;
    }

    // ─── 2. Check embedding model ────────────────────────────
    if (isModelDownloaded()) {
        log.success("Embedding model is cached");
    } else {
        log.warn("Embedding model not downloaded — will download on first use");
        issues++;
    }

    // ─── 3. Check global database ────────────────────────────
    const globalPaths = getGlobalPaths();
    if (existsSync(globalPaths.globalDbPath)) {
        const db = createDatabase(globalPaths.globalDbPath);
        const count = getSkillCount(db);
        log.success(`Global database: ${count} skills indexed`);

        // Check for stale references
        const skills = getAllSkills(db);
        let staleCount = 0;
        for (const skill of skills) {
            if (!fileExists(skill.file_path)) {
                staleCount++;
                log.warn(`  Stale reference: ${skill.name} → ${skill.file_path}`);
            }
        }
        if (staleCount > 0) {
            log.warn(`${staleCount} stale references found — run 'skill-depot reindex' to fix`);
            issues++;
        }

        db.close();
    } else {
        log.info("Global database not created yet");
    }

    // ─── 4. Check project ────────────────────────────────────
    const projectRoot = process.cwd();
    if (isProjectInitialized(projectRoot)) {
        log.success("Project-level skill-depot found");

        if (existsSync(globalPaths.globalDbPath)) {
            const db = createDatabase(globalPaths.globalDbPath);
            const skills = getAllSkills(db, "project", projectRoot);
            log.success(`Project database: ${skills.length} skills indexed in global DB`);

            let staleCount = 0;
            for (const skill of skills) {
                if (!fileExists(skill.file_path)) {
                    staleCount++;
                }
            }
            if (staleCount > 0) {
                log.warn(`${staleCount} stale project references — run 'skill-depot reindex'`);
                issues++;
            }
            db.close();
        }
    } else {
        log.info("No project-level skill-depot in current directory");
    }

    // ─── Summary ──────────────────────────────────────────────
    console.log();
    if (issues === 0) {
        log.success("All checks passed! skill-depot is healthy.");
    } else {
        log.warn(`${issues} issue(s) found. See above for details.`);
    }
}
