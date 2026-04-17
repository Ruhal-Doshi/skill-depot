import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { listSkillFiles } from "../core/file-manager.js";
import matter from "gray-matter";

export interface DiscoveredAgent {
    name: string;
    globalPaths: string[];
    projectPaths: string[];
}

export interface DiscoveredSkills {
    agent: string;
    scope: "global" | "project";
    directory: string;
    files: string[];
}

/**
 * Known non-skill files that can appear in agent root directories.
 * These are always skipped even if they happen to have frontmatter.
 */
const KNOWN_NON_SKILL_FILES = new Set([
    "claude.md",
    "agents.md",
    "readme.md",
    "changelog.md",
    "contributing.md",
    "license.md",
]);

/**
 * Check if a .md file looks like a valid skill file by verifying
 * it has YAML frontmatter with at least a `description` field.
 */
function isSkillFile(filePath: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    if (KNOWN_NON_SKILL_FILES.has(basename)) return false;

    try {
        const raw = readFileSync(filePath, "utf-8");
        const { data } = matter(raw);
        return typeof data.description === "string" && data.description.length > 0;
    } catch {
        return false;
    }
}

/**
 * Scan a skills.sh canonical directory (~/.agents/skills/ or <cwd>/.agents/skills/).
 * Each subdirectory contains a SKILL.md file — the pattern is <dir>/<name>/SKILL.md.
 * Returns the SKILL.md file paths for every valid skill found.
 */
function scanSkillsShDir(dirPath: string): string[] {
    if (!existsSync(dirPath)) return [];

    const results: string[] = [];
    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillMd = path.join(dirPath, entry.name, "SKILL.md");
            if (existsSync(skillMd)) {
                results.push(skillMd);
            }
        }
    } catch {
        // directory unreadable
    }
    return results;
}

/**
 * Detect all known agents and their skill directories
 */
export async function detectAgents(
    projectRoot?: string
): Promise<DiscoveredSkills[]> {
    const results: DiscoveredSkills[] = [];
    const home = os.homedir();

    /**
     * Scan a list of directories for skill files.
     * - "dedicated" dirs (e.g. .agent/skills/) trust ALL .md files as skills.
     * - "root" dirs (e.g. .agent/) validate each file has frontmatter+description.
     *
     * Each entry is { path, dedicated: boolean }.
     */
    const scanDirs = async (
        dirs: Array<{ path: string; dedicated: boolean }>,
        agent: string,
        scope: "global" | "project"
    ) => {
        const seen = new Set<string>();
        for (const { path: dir, dedicated } of dirs) {
            if (existsSync(dir)) {
                let files = await listSkillFiles(dir);

                if (!dedicated) {
                    files = files.filter(isSkillFile);
                }

                const newFiles = files.filter((f) => !seen.has(f));
                newFiles.forEach((f) => seen.add(f));
                if (newFiles.length > 0) {
                    results.push({ agent, scope, directory: dir, files: newFiles });
                }
            }
        }
    };

    // ─── skills.sh canonical store (~/.agents/skills/<name>/SKILL.md) ───
    const globalAgentsSkillsDir = path.join(home, ".agents", "skills");
    const skillsShFiles = scanSkillsShDir(globalAgentsSkillsDir);
    if (skillsShFiles.length > 0) {
        results.push({
            agent: "skills.sh",
            scope: "global",
            directory: globalAgentsSkillsDir,
            files: skillsShFiles,
        });
    }

    if (projectRoot) {
        const projectAgentsSkillsDir = path.join(projectRoot, ".agents", "skills");
        const projectSkillsShFiles = scanSkillsShDir(projectAgentsSkillsDir);
        if (projectSkillsShFiles.length > 0) {
            results.push({
                agent: "skills.sh",
                scope: "project",
                directory: projectAgentsSkillsDir,
                files: projectSkillsShFiles,
            });
        }
    }

    // ─── Claude Code ────────────────────────────────────────────
    await scanDirs(
        [
            { path: path.join(home, ".claude"), dedicated: false },
            { path: path.join(home, ".claude", "skills"), dedicated: true },
            { path: path.join(home, ".claude", "commands"), dedicated: true },
        ],
        "Claude Code",
        "global"
    );

    if (projectRoot) {
        await scanDirs(
            [
                { path: path.join(projectRoot, ".agent"), dedicated: false },
                { path: path.join(projectRoot, ".agent", "skills"), dedicated: true },
                { path: path.join(projectRoot, ".claude"), dedicated: false },
                { path: path.join(projectRoot, ".claude", "skills"), dedicated: true },
                { path: path.join(projectRoot, ".claude", "commands"), dedicated: true },
            ],
            "Claude Code",
            "project"
        );
    }

    // ─── Codex ──────────────────────────────────────────────────
    await scanDirs(
        [
            { path: path.join(home, ".codex"), dedicated: false },
            { path: path.join(home, ".codex", "skills"), dedicated: true },
        ],
        "Codex",
        "global"
    );

    if (projectRoot) {
        await scanDirs(
            [
                { path: path.join(projectRoot, ".codex"), dedicated: false },
                { path: path.join(projectRoot, ".codex", "skills"), dedicated: true },
            ],
            "Codex",
            "project"
        );
    }

    // ─── OpenClaw ───────────────────────────────────────────────
    await scanDirs(
        [
            { path: path.join(home, ".openclaw"), dedicated: false },
            { path: path.join(home, ".openclaw", "skills"), dedicated: true },
            { path: path.join(home, ".open-claw"), dedicated: false },
            { path: path.join(home, ".open-claw", "skills"), dedicated: true },
        ],
        "OpenClaw",
        "global"
    );

    if (projectRoot) {
        await scanDirs(
            [
                { path: path.join(projectRoot, ".openclaw"), dedicated: false },
                { path: path.join(projectRoot, ".openclaw", "skills"), dedicated: true },
                { path: path.join(projectRoot, ".open-claw"), dedicated: false },
                { path: path.join(projectRoot, ".open-claw", "skills"), dedicated: true },
            ],
            "OpenClaw",
            "project"
        );
    }

    // ─── Gemini / .gemini directory ─────────────────────────────
    await scanDirs(
        [
            { path: path.join(home, ".gemini"), dedicated: false },
            { path: path.join(home, ".gemini", "skills"), dedicated: true },
        ],
        "Gemini",
        "global"
    );

    if (projectRoot) {
        await scanDirs(
            [
                { path: path.join(projectRoot, ".gemini"), dedicated: false },
                { path: path.join(projectRoot, ".gemini", "skills"), dedicated: true },
            ],
            "Gemini",
            "project"
        );
    }

    return results;
}

/**
 * Get a summary of discovered agents for display
 */
export function summarizeDiscovery(
    discovered: DiscoveredSkills[]
): {
    totalSkills: number;
    globalSkills: number;
    projectSkills: number;
    agents: string[];
} {
    const totalSkills = discovered.reduce((sum, d) => sum + d.files.length, 0);
    const globalSkills = discovered
        .filter((d) => d.scope === "global")
        .reduce((sum, d) => sum + d.files.length, 0);
    const projectSkills = discovered
        .filter((d) => d.scope === "project")
        .reduce((sum, d) => sum + d.files.length, 0);
    const agents = [...new Set(discovered.map((d) => d.agent))];

    return { totalSkills, globalSkills, projectSkills, agents };
}
