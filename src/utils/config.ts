import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { getGlobalPaths } from "../core/storage.js";

export interface SkillDepotConfig {
    version: string;
    projectRoots: string[];
    embeddingModel: string;
    defaultScope: "global" | "project";
}

const DEFAULT_CONFIG: SkillDepotConfig = {
    version: "0.1.0",
    projectRoots: [],
    embeddingModel: "Xenova/all-MiniLM-L6-v2",
    defaultScope: "global",
};

/**
 * Load global config from ~/.skill-depot/config.json
 */
export async function loadConfig(): Promise<SkillDepotConfig> {
    const { configPath } = getGlobalPaths();

    if (!existsSync(configPath)) {
        return { ...DEFAULT_CONFIG };
    }

    try {
        const content = await fs.readFile(configPath, "utf-8");
        const parsed = JSON.parse(content);
        return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

/**
 * Save global config
 */
export async function saveConfig(config: SkillDepotConfig): Promise<void> {
    const { configPath } = getGlobalPaths();
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Add a project root to the config
 */
export async function addProjectRoot(projectRoot: string): Promise<void> {
    const config = await loadConfig();
    if (!config.projectRoots.includes(projectRoot)) {
        config.projectRoots.push(projectRoot);
        await saveConfig(config);
    }
}
