import path from "node:path";
import ora from "ora";

import { ensureGlobalDirs, ensureProjectDirs, getGlobalPaths, getProjectPaths, getSkillFilePath } from "../core/storage.js";
import { createDatabase, insertSkill, getSkillByName } from "../core/database.js";
import { generateEmbedding } from "../core/embeddings.js";
import { readSkillFile, copySkillFile, getSkillNameFromPath, hashContent } from "../core/file-manager.js";
import { generateIndexableText, generateSnippet } from "../core/frontmatter.js";
import * as log from "../utils/logger.js";

interface AddOptions {
    global?: boolean;
}

export async function addCommand(file: string, options: AddOptions): Promise<void> {
    const filePath = path.resolve(file);
    const scope = options.global ? "global" : "project";
    const projectRoot = process.cwd();

    const globalPaths = await ensureGlobalDirs();
    const projectPaths = scope === "project" ? await ensureProjectDirs(projectRoot) : null;

    const dbPath = globalPaths.globalDbPath;
    const db = createDatabase(dbPath);

    try {
        // Read the skill file
        const parsed = await readSkillFile(filePath);
        const name = parsed.frontmatter.name || getSkillNameFromPath(filePath);

        // Check if already exists
        const existing = getSkillByName(db, name);
        if (existing) {
            log.warn(`Skill "${name}" already exists. Use 'skill-depot reindex' to update.`);
            return;
        }

        // Copy to skill-depot's directory
        const destDir = scope === "global" ? globalPaths.globalSkillsDir : projectPaths!.projectSkillsDir;
        const destPath = path.join(destDir, path.basename(filePath));
        await copySkillFile(filePath, destPath);

        // Index it
        const spinner = ora(`Indexing ${name}...`).start();
        const indexableText = generateIndexableText(parsed.frontmatter, parsed.body);
        const snippet = generateSnippet(parsed.frontmatter, parsed.body);
        const embedding = await generateEmbedding(indexableText);
        const contentHash = hashContent(parsed.raw);

        insertSkill(db, {
            name,
            description: parsed.frontmatter.description,
            tags: parsed.frontmatter.tags,
            keywords: parsed.frontmatter.keywords,
            contentHash,
            filePath: destPath,
            scope,
            projectPath: scope === "global" ? "" : projectRoot,
            snippet,
            indexableText,
            embedding,
        });

        spinner.succeed(`Added and indexed: ${name} [${scope}]`);
    } finally {
        db.close();
    }
}
