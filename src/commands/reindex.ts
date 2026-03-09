import ora from "ora";
import { ensureGlobalDirs, ensureProjectDirs, getGlobalPaths, getProjectPaths } from "../core/storage.js";
import { createDatabase, clearSkillsByScope, insertSkill } from "../core/database.js";
import { generateEmbedding } from "../core/embeddings.js";
import { readSkillFile, listSkillFiles, hashContent, getSkillNameFromPath } from "../core/file-manager.js";
import { generateIndexableText, generateSnippet } from "../core/frontmatter.js";
import * as log from "../utils/logger.js";

export async function reindexCommand(scope: "all" | "global" | "project"): Promise<void> {
    const projectRoot = process.cwd();
    let totalIndexed = 0;

    if (scope === "all" || scope === "global") {
        const globalPaths = await ensureGlobalDirs();
        const globalDb = createDatabase(globalPaths.globalDbPath);

        try {
            const files = await listSkillFiles(globalPaths.globalSkillsDir);
            const spinner = ora(`Reindexing ${files.length} global skills...`).start();

            clearSkillsByScope(globalDb, "global");

            for (const filePath of files) {
                try {
                    const parsed = await readSkillFile(filePath);
                    const name = parsed.frontmatter.name || getSkillNameFromPath(filePath);
                    const indexableText = generateIndexableText(parsed.frontmatter, parsed.body);
                    const snippet = generateSnippet(parsed.frontmatter, parsed.body);
                    const embedding = await generateEmbedding(indexableText);
                    const contentHash = hashContent(parsed.raw);

                    insertSkill(globalDb, {
                        name,
                        description: parsed.frontmatter.description,
                        tags: parsed.frontmatter.tags,
                        keywords: parsed.frontmatter.keywords,
                        contentHash,
                        filePath,
                        scope: "global",
                        projectPath: "",
                        snippet,
                        indexableText,
                        embedding,
                    });
                    totalIndexed++;
                } catch (err) {
                    log.warn(`Failed to index ${filePath}: ${(err as Error).message}`);
                }
            }

            spinner.succeed(`Reindexed ${files.length} global skills`);
        } finally {
            globalDb.close();
        }
    }

    if (scope === "all" || scope === "project") {
        try {
            const projectPaths = await ensureProjectDirs(projectRoot);

            // Project mode queries from global DB too now
            const globalPaths = await ensureGlobalDirs();
            const globalDb = createDatabase(globalPaths.globalDbPath);

            try {
                const files = await listSkillFiles(projectPaths.projectSkillsDir);
                const spinner = ora(`Reindexing ${files.length} project skills...`).start();

                clearSkillsByScope(globalDb, "project", projectRoot);

                for (const filePath of files) {
                    try {
                        const parsed = await readSkillFile(filePath);
                        const name = parsed.frontmatter.name || getSkillNameFromPath(filePath);
                        const indexableText = generateIndexableText(parsed.frontmatter, parsed.body);
                        const snippet = generateSnippet(parsed.frontmatter, parsed.body);
                        const embedding = await generateEmbedding(indexableText);
                        const contentHash = hashContent(parsed.raw);

                        insertSkill(globalDb, {
                            name,
                            description: parsed.frontmatter.description,
                            tags: parsed.frontmatter.tags,
                            keywords: parsed.frontmatter.keywords,
                            contentHash,
                            filePath,
                            scope: "project",
                            projectPath: projectRoot,
                            snippet,
                            indexableText,
                            embedding,
                        });
                        totalIndexed++;
                    } catch (err) {
                        log.warn(`Failed to index ${filePath}: ${(err as Error).message}`);
                    }
                }

                spinner.succeed(`Reindexed ${files.length} project skills`);
            } finally {
                globalDb.close();
            }
        } catch {
            log.info("No project-level skill-depot found in current directory");
        }
    }

    log.success(`Total reindexed: ${totalIndexed} skills`);
}
