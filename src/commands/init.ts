import path from "node:path";
import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";

import { ensureGlobalDirs, ensureProjectDirs, getGlobalPaths, getProjectPaths, addToGitignore } from "../core/storage.js";
import { createDatabase, insertSkill, getSkillByName } from "../core/database.js";
import { generateEmbedding, isModelDownloaded } from "../core/embeddings.js";
import { readSkillFile, copySkillFile, getSkillNameFromPath, hashContent, deleteSkillFile, listSkillFiles, fileExists } from "../core/file-manager.js";
import { generateIndexableText, generateSnippet } from "../core/frontmatter.js";
import { detectAgents, summarizeDiscovery, type DiscoveredSkills } from "../discovery/detector.js";
import { saveConfig, type SkillDepotConfig } from "../utils/config.js";
import { VERSION } from "../utils/version.js";
import * as log from "../utils/logger.js";

interface InitOptions {
    auto?: boolean;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
    console.log();
    console.log(chalk.bold.white("  ⚡ skill-depot init"));
    console.log(chalk.dim("  RAG-based skill retrieval for AI agents"));
    console.log();

    const projectRoot = process.cwd();

    // ─── 1. Ensure directories ──────────────────────────────────
    const spinner = ora("Setting up skill-depot directories...").start();
    const globalPaths = await ensureGlobalDirs();
    const projectPaths = await ensureProjectDirs(projectRoot);
    spinner.succeed("Directories created");

    // ─── 2. Auto-add .gitignore entry ──────────────────────────
    const gitignoreAdded = await addToGitignore(projectRoot);
    if (gitignoreAdded) {
        log.success("Added .skill-depot/index.db to .gitignore");
    } else {
        log.warn(
            "Could not update .gitignore — please manually add: .skill-depot/index.db"
        );
    }

    // ─── 3. Discover existing agent skills ─────────────────────
    log.heading("Discovering existing skills");

    const discovered = await detectAgents(projectRoot);
    const summary = summarizeDiscovery(discovered);

    if (summary.totalSkills === 0) {
        log.info("No existing agent skills found. You can add skills later using the MCP tools.");
    } else {
        console.log();
        log.info(
            `Found ${chalk.bold(summary.totalSkills)} skills across ${summary.agents.join(", ")}`
        );
    }

    // ─── 4. Import global skills ───────────────────────────────
    const globalDiscovered = discovered.filter((d) => d.scope === "global");
    let globalCopied: string[] = [];

    if (globalDiscovered.length > 0) {
        log.heading("Global Skills");
        globalCopied = await selectAndCopySkills(
            globalDiscovered,
            globalPaths.globalSkillsDir,
            options.auto || false
        );
    }

    // ─── 5. Import project skills ─────────────────────────────
    const projectDiscovered = discovered.filter((d) => d.scope === "project");
    let projectCopied: string[] = [];

    if (projectDiscovered.length > 0) {
        log.heading("Project Skills");
        projectCopied = await selectAndCopySkills(
            projectDiscovered,
            projectPaths.projectSkillsDir,
            options.auto || false
        );
    }

    // ─── 6. Ask to delete originals ────────────────────────────
    const allCopied = [...globalCopied, ...projectCopied];
    if (allCopied.length > 0 && !options.auto) {
        console.log();
        const { shouldDelete } = await inquirer.prompt([
            {
                type: "confirm",
                name: "shouldDelete",
                message: "Remove the original files from agent directories?",
                default: false,
            },
        ]);

        if (shouldDelete) {
            for (const srcPath of allCopied) {
                await deleteSkillFile(srcPath);
            }
            log.success(`Cleaned up ${allCopied.length} original files`);
        } else {
            console.log();
            log.warn(
                "Skills left in agent directories will still be loaded into context alongside skill-depot results."
            );
            log.warn(
                "Consider removing them manually once you've confirmed skill-depot is working."
            );
        }
    }

    // ─── 7. Download embedding model ──────────────────────────
    log.heading("Indexing");

    if (!isModelDownloaded()) {
        const modelSpinner = ora("Downloading embedding model...").start();
        // Trigger model download by generating a test embedding
        await generateEmbedding("test", (progress) => {
            if (progress.progress !== undefined) {
                modelSpinner.text = `Downloading embedding model... ${Math.round(progress.progress)}%`;
            }
        });
        modelSpinner.succeed("Embedding model downloaded");
    } else {
        log.success("Embedding model already cached");
    }

    // ─── 8. Index all skills ──────────────────────────────────
    const globalDb = createDatabase(globalPaths.globalDbPath);
    const projectDb = createDatabase(projectPaths.projectDbPath);

    const globalFiles = await listSkillFiles(globalPaths.globalSkillsDir);
    const projectFiles = await listSkillFiles(projectPaths.projectSkillsDir);
    const totalFiles = globalFiles.length + projectFiles.length;

    if (totalFiles > 0) {
        const indexSpinner = ora(`Indexing ${totalFiles} skills...`).start();

        let indexed = 0;
        for (const filePath of globalFiles) {
            await indexFile(globalDb, filePath, "global");
            indexed++;
            indexSpinner.text = `Indexing skills... ${indexed}/${totalFiles}`;
        }
        for (const filePath of projectFiles) {
            await indexFile(projectDb, filePath, "project");
            indexed++;
            indexSpinner.text = `Indexing skills... ${indexed}/${totalFiles}`;
        }

        indexSpinner.succeed(`Indexed ${totalFiles} skills`);
    } else {
        log.info("No skills to index yet");
    }

    globalDb.close();
    projectDb.close();

    // ─── 9. Save config ────────────────────────────────────────
    const config: SkillDepotConfig = {
        version: VERSION,
        projectRoots: [projectRoot],
        embeddingModel: "Xenova/all-MiniLM-L6-v2",
        defaultScope: "global",
    };
    await saveConfig(config);

    // ─── 10. Print success ────────────────────────────────────
    log.heading("Ready");
    console.log();
    log.success("skill-depot is ready!");
    console.log();
    console.log(chalk.dim("  Add this to your agent's MCP config:"));
    console.log();
    console.log(
        chalk.white(
            JSON.stringify(
                {
                    "skill-depot": {
                        command: "npx",
                        args: ["skill-depot", "serve"],
                    },
                },
                null,
                2
            )
                .split("\n")
                .map((line) => `  ${line}`)
                .join("\n")
        )
    );
    console.log();
}

/**
 * Present a checklist of discovered skills and copy selected ones
 */
async function selectAndCopySkills(
    discovered: DiscoveredSkills[],
    destDir: string,
    autoSelect: boolean
): Promise<string[]> {
    // Build choices from all discovered sources
    const choices = discovered.flatMap((d) =>
        d.files.map((filePath) => ({
            name: `${chalk.dim(`${d.agent}:`)} ${path.basename(filePath)}`,
            value: filePath,
            checked: true, // Select all by default
        }))
    );

    let selectedFiles: string[];

    if (autoSelect) {
        selectedFiles = choices.map((c) => c.value);
    } else {
        const { selected } = await inquirer.prompt([
            {
                type: "checkbox",
                name: "selected",
                message: "Select skills to import:",
                choices,
            },
        ]);
        selectedFiles = selected;
    }

    // Copy selected files
    const copiedSources: string[] = [];
    for (const srcPath of selectedFiles) {
        const baseName = path.basename(srcPath);
        let destPath = path.join(destDir, baseName);
        let counter = 1;

        // Auto-resolve naming collisions
        while (fileExists(destPath)) {
            const ext = path.extname(baseName);
            const nameWithoutExt = path.basename(baseName, ext);
            destPath = path.join(destDir, `${nameWithoutExt}-${counter}${ext}`);
            counter++;
        }

        await copySkillFile(srcPath, destPath);
        copiedSources.push(srcPath);
    }

    if (copiedSources.length > 0) {
        log.success(`Copied ${copiedSources.length} skills to ${chalk.dim(destDir)}`);
    }

    return copiedSources;
}

/**
 * Index a single skill file into the database
 */
async function indexFile(
    db: ReturnType<typeof createDatabase>,
    filePath: string,
    scope: "global" | "project"
): Promise<void> {
    const parsed = await readSkillFile(filePath);
    let name = parsed.frontmatter.name || getSkillNameFromPath(filePath);

    // Resolve name collisions in the database
    let counter = 1;
    let baseName = name;
    while (getSkillByName(db, name)) {
        name = `${baseName}-${counter}`;
        counter++;
    }

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
        filePath,
        scope,
        snippet,
        indexableText,
        embedding,
    });
}
