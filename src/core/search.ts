import Database from "better-sqlite3";
import {
    searchByVector,
    getSkillById,
    getAllSkills,
    type SkillRecord,
} from "./database.js";
import { generateEmbedding } from "./embeddings.js";

export interface SearchResult {
    name: string;
    description: string;
    tags: string[];
    scope: "global" | "project";
    snippet: string;
    relevanceScore: number;
}

interface SearchOptions {
    topK?: number;
    scope?: "all" | "global" | "project";
    cwd?: string;
}

/**
 * Search for skills across databases using semantic vector search.
 */
export async function searchSkills(
    db: Database.Database,
    query: string,
    options: SearchOptions = {}
): Promise<SearchResult[]> {
    const { topK = 5, scope = "all", cwd } = options;

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    const vectorResults = searchByVector(db, queryEmbedding, topK, scope, cwd);
    const results: SearchResult[] = [];

    for (const vr of vectorResults) {
        const skill = getSkillById(db, vr.skillId);
        if (!skill) continue;

        // Convert distance to a similarity score (0-1, higher is better)
        const relevanceScore = 1 / (1 + vr.distance);

        results.push({
            name: skill.name,
            description: skill.description,
            tags: JSON.parse(skill.tags) as string[],
            scope: skill.scope as "global" | "project",
            snippet: skill.snippet,
            relevanceScore,
        });
    }

    return results;
}

/**
 * List all indexed skills with optional filtering
 */
export function listSkills(
    db: Database.Database,
    scope?: "all" | "global" | "project",
    cwd?: string,
    tag?: string
): Array<{
    name: string;
    description: string;
    scope: string;
    tags: string[];
}> {
    const results: Array<{
        name: string;
        description: string;
        scope: string;
        tags: string[];
    }> = [];

    const mapRecord = (r: SkillRecord) => ({
        name: r.name,
        description: r.description,
        scope: r.scope,
        tags: JSON.parse(r.tags) as string[],
    });

    if (!scope || scope === "all" || scope === "global") {
        const globalSkills = getAllSkills(db, "global", undefined, tag);
        results.push(...globalSkills.map(mapRecord));
    }

    if (cwd && (!scope || scope === "all" || scope === "project")) {
        const projectSkills = getAllSkills(db, "project", cwd, tag);
        results.push(...projectSkills.map(mapRecord));
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
}
