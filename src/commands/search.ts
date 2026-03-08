import chalk from "chalk";
import { ensureGlobalDirs, ensureProjectDirs } from "../core/storage.js";
import { createDatabase } from "../core/database.js";
import { searchSkills } from "../core/search.js";
import * as log from "../utils/logger.js";

export async function searchCommand(query: string, topK: number = 5): Promise<void> {
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
        const results = await searchSkills(globalDb, projectDb, query, { topK });

        if (results.length === 0) {
            log.info("No matching skills found.");
            return;
        }

        console.log();
        for (const result of results) {
            const score = chalk.dim(`(${(result.relevanceScore * 100).toFixed(1)}%)`);
            const scopeLabel = result.scope === "global" ? chalk.magenta("[global]") : chalk.cyan("[project]");
            console.log(`  ${scopeLabel} ${chalk.bold.white(result.name)} ${score}`);
            if (result.description) {
                console.log(`    ${chalk.dim(result.description)}`);
            }
            if (result.tags.length > 0) {
                console.log(`    ${chalk.dim("tags:")} ${result.tags.map(t => chalk.yellow(t)).join(", ")}`);
            }
            console.log();
        }
    } finally {
        globalDb.close();
        projectDb?.close();
    }
}
