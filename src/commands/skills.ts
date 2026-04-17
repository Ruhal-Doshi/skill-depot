import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import inquirer from "inquirer";
import ora from "ora";
import chalk from "chalk";

import { ensureGlobalDirs, getGlobalPaths } from "../core/storage.js";
import { createDatabase, insertSkill, getSkillByName } from "../core/database.js";
import { generateEmbedding } from "../core/embeddings.js";
import { readSkillFile, getSkillNameFromPath, hashContent } from "../core/file-manager.js";
import { generateIndexableText, generateSnippet, generateOverview } from "../core/frontmatter.js";
import { findAgentSymlinks, removeSymlinks } from "../discovery/symlink-cleaner.js";
import * as log from "../utils/logger.js";

// ─── helpers ────────────────────────────────────────────────

export function getCanonicalSkillsDir(): string {
    return path.join(os.homedir(), ".agents", "skills");
}

export interface CanonicalSkill {
    name: string;
    skillMdPath: string;
}

/**
 * List every skill in the skills.sh canonical store.
 */
export function listCanonicalSkills(): CanonicalSkill[] {
    const dir = getCanonicalSkillsDir();
    if (!existsSync(dir)) return [];

    const results: CanonicalSkill[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(dir, entry.name, "SKILL.md");
        if (existsSync(skillMd)) {
            results.push({ name: entry.name, skillMdPath: skillMd });
        }
    }
    return results;
}

/**
 * Index a single SKILL.md into the database, skipping if already present.
 * Returns true if the skill was indexed, false if skipped.
 */
export async function indexSkillMd(
    db: ReturnType<typeof createDatabase>,
    skillMdPath: string,
    skillDirName: string
): Promise<boolean> {
    const parsed = await readSkillFile(skillMdPath);
    const name = parsed.frontmatter.name || skillDirName;

    const existing = getSkillByName(db, name);
    const contentHash = hashContent(parsed.raw);
    if (existing && existing.content_hash === contentHash) {
        return false;
    }

    const indexableText = generateIndexableText(parsed.frontmatter, parsed.body);
    const snippet = generateSnippet(parsed.frontmatter, parsed.body);
    const overview = generateOverview(parsed.body);
    const embedding = await generateEmbedding(indexableText);

    insertSkill(db, {
        name,
        description: parsed.frontmatter.description ?? "",
        tags: parsed.frontmatter.tags ?? [],
        keywords: parsed.frontmatter.keywords ?? [],
        contentHash,
        filePath: skillMdPath,
        scope: "global",
        projectPath: "",
        snippet,
        overview,
        indexableText,
        related: parsed.frontmatter.related ?? [],
        embedding,
    });

    return true;
}

// ─── skill-depot skills add ─────────────────────────────────

function runNpxSkills(args: string[]): Promise<number> {
    return new Promise((resolve) => {
        const child = spawn("npx", ["skills", ...args], {
            stdio: "inherit",
            shell: true,
        });
        child.on("close", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(1));
    });
}

export async function skillsAddCommand(args: string[]): Promise<void> {
    log.heading("Running skills.sh");

    const exitCode = await runNpxSkills(["add", ...args]);
    if (exitCode !== 0) {
        log.error("skills.sh exited with an error — skipping indexing");
        return;
    }

    console.log();
    log.heading("Indexing into skill-depot");

    await ensureGlobalDirs();
    const globalPaths = getGlobalPaths();
    const db = createDatabase(globalPaths.globalDbPath);

    const skills = listCanonicalSkills();
    if (skills.length === 0) {
        log.info("No skills found in ~/.agents/skills/");
        db.close();
        return;
    }

    const spinner = ora(`Indexing ${skills.length} skills...`).start();
    let indexed = 0;
    let skipped = 0;

    for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        try {
            const wasIndexed = await indexSkillMd(db, skill.skillMdPath, skill.name);
            if (wasIndexed) indexed++;
            else skipped++;
        } catch (err) {
            log.warn(`Skipped ${skill.name}: ${(err as Error).message}`);
            skipped++;
        }
        spinner.text = `Indexing skills... ${i + 1}/${skills.length}`;
    }

    const skippedMsg = skipped > 0 ? ` (${skipped} already indexed)` : "";
    spinner.succeed(`Indexed ${indexed} new skills${skippedMsg}`);
    db.close();

    await promptSymlinkCleanup(args.includes("-y") || args.includes("--yes"));
}

// ─── skill-depot skills import ──────────────────────────────

export async function skillsImportCommand(): Promise<void> {
    log.heading("Importing skills from skills.sh");

    await ensureGlobalDirs();
    const globalPaths = getGlobalPaths();
    const db = createDatabase(globalPaths.globalDbPath);

    const skills = listCanonicalSkills();
    if (skills.length === 0) {
        log.info("No skills found in ~/.agents/skills/. Install some first with: npx skills add <package>");
        db.close();
        return;
    }

    log.info(`Found ${chalk.bold(skills.length)} skills in ~/.agents/skills/`);

    const spinner = ora(`Indexing ${skills.length} skills...`).start();
    let indexed = 0;
    let skipped = 0;

    for (let i = 0; i < skills.length; i++) {
        const skill = skills[i];
        try {
            const wasIndexed = await indexSkillMd(db, skill.skillMdPath, skill.name);
            if (wasIndexed) indexed++;
            else skipped++;
        } catch (err) {
            log.warn(`Skipped ${skill.name}: ${(err as Error).message}`);
            skipped++;
        }
        spinner.text = `Indexing skills... ${i + 1}/${skills.length}`;
    }

    const skippedMsg = skipped > 0 ? ` (${skipped} already indexed)` : "";
    spinner.succeed(`Indexed ${indexed} new skills${skippedMsg}`);
    db.close();

    await promptSymlinkCleanup(false);
}

// ─── skill-depot skills list ────────────────────────────────

export async function skillsListCommand(): Promise<void> {
    const globalPaths = getGlobalPaths();
    const canonicalSkills = listCanonicalSkills();

    if (canonicalSkills.length === 0) {
        log.info("No skills found in ~/.agents/skills/");
        return;
    }

    let db: ReturnType<typeof createDatabase> | null = null;
    if (existsSync(globalPaths.globalDbPath)) {
        db = createDatabase(globalPaths.globalDbPath);
    }

    console.log();
    log.info(`${chalk.bold(canonicalSkills.length)} skills in ~/.agents/skills/`);
    console.log();

    for (const skill of canonicalSkills) {
        const inDepot = db ? !!getSkillByName(db, skill.name) : false;
        const status = inDepot
            ? chalk.green("indexed")
            : chalk.yellow("not indexed");
        console.log(`  ${chalk.white(skill.name)} ${chalk.dim("—")} ${status}`);
    }

    db?.close();
    console.log();
}

// ─── shared: symlink cleanup prompt ─────────────────────────

async function promptSymlinkCleanup(autoYes: boolean): Promise<void> {
    const symlinks = findAgentSymlinks();
    if (symlinks.length === 0) return;

    console.log();
    log.info(
        `Found ${chalk.bold(symlinks.length)} agent-directory symlinks that can be removed to reduce context bloat`
    );

    const uniqueDirs = [...new Set(symlinks.map((s) => path.dirname(s.linkPath)))];
    for (const dir of uniqueDirs) {
        const count = symlinks.filter((s) => path.dirname(s.linkPath) === dir).length;
        console.log(chalk.dim(`  ${dir} (${count} symlinks)`));
    }

    let shouldRemove = autoYes;
    if (!autoYes) {
        const { confirm } = await inquirer.prompt([
            {
                type: "confirm",
                name: "confirm",
                message: "Remove these symlinks? Skills will still be searchable via skill-depot.",
                default: true,
            },
        ]);
        shouldRemove = confirm;
    }

    if (shouldRemove) {
        const removed = await removeSymlinks(symlinks);
        log.success(`Removed ${removed} symlinks from agent directories`);
    } else {
        log.warn(
            "Symlinks left in place — agent context will include these skills alongside skill-depot results."
        );
    }
}
