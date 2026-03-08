import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

const GLOBAL_DIR_NAME = ".skill-depot";

export interface StoragePaths {
    globalDir: string;
    globalSkillsDir: string;
    globalDbPath: string;
    modelsDir: string;
    configPath: string;
    daemonPidPath: string;
}

export interface ProjectPaths {
    projectDir: string;
    projectSkillsDir: string;
    projectDbPath: string;
}

/**
 * Get the global skill-depot directory path (~/.skill-depot/)
 */
export function getGlobalDir(): string {
    return path.join(os.homedir(), GLOBAL_DIR_NAME);
}

/**
 * Get all global storage paths
 */
export function getGlobalPaths(): StoragePaths {
    const globalDir = getGlobalDir();
    return {
        globalDir,
        globalSkillsDir: path.join(globalDir, "skills"),
        globalDbPath: path.join(globalDir, "index.db"),
        modelsDir: path.join(globalDir, "models"),
        configPath: path.join(globalDir, "config.json"),
        daemonPidPath: path.join(globalDir, "daemon.pid"),
    };
}

/**
 * Get project-level storage paths for a given project root
 */
export function getProjectPaths(projectRoot: string): ProjectPaths {
    const projectDir = path.join(projectRoot, GLOBAL_DIR_NAME);
    return {
        projectDir,
        projectSkillsDir: path.join(projectDir, "skills"),
        projectDbPath: path.join(projectDir, "index.db"),
    };
}

/**
 * Ensure all global directories exist
 */
export async function ensureGlobalDirs(): Promise<StoragePaths> {
    const paths = getGlobalPaths();
    await fs.mkdir(paths.globalSkillsDir, { recursive: true });
    await fs.mkdir(paths.modelsDir, { recursive: true });
    return paths;
}

/**
 * Ensure project-level directories exist
 */
export async function ensureProjectDirs(
    projectRoot: string
): Promise<ProjectPaths> {
    const paths = getProjectPaths(projectRoot);
    await fs.mkdir(paths.projectSkillsDir, { recursive: true });
    return paths;
}

/**
 * Get the full path for a skill file given its name and scope
 */
export function getSkillFilePath(
    name: string,
    scope: "global" | "project",
    projectRoot?: string
): string {
    const filename = name.endsWith(".md") ? name : `${name}.md`;
    if (scope === "global") {
        return path.join(getGlobalPaths().globalSkillsDir, filename);
    }
    if (!projectRoot) {
        throw new Error("projectRoot is required for project-scoped skills");
    }
    return path.join(getProjectPaths(projectRoot).projectSkillsDir, filename);
}

/**
 * Check if a project has been initialized with skill-depot
 */
export function isProjectInitialized(projectRoot: string): boolean {
    return existsSync(getProjectPaths(projectRoot).projectDir);
}

/**
 * Check if the global skill-depot has been initialized
 */
export function isGlobalInitialized(): boolean {
    return existsSync(getGlobalDir());
}

/**
 * Attempt to add .skill-depot/index.db to the project's .gitignore.
 * Returns true if successful, false if no .gitignore found or write failed.
 */
export async function addToGitignore(projectRoot: string): Promise<boolean> {
    const gitignorePath = path.join(projectRoot, ".gitignore");
    const entry = ".skill-depot/index.db";

    try {
        let content = "";
        if (existsSync(gitignorePath)) {
            content = await fs.readFile(gitignorePath, "utf-8");
            // Already present
            if (content.includes(entry)) {
                return true;
            }
        }

        const newline = content.endsWith("\n") || content === "" ? "" : "\n";
        await fs.writeFile(
            gitignorePath,
            `${content}${newline}\n# skill-depot index (machine-specific, rebuilt via 'skill-depot reindex')\n${entry}\n`,
            "utf-8"
        );
        return true;
    } catch {
        return false;
    }
}
