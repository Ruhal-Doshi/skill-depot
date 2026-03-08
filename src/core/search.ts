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
}

/**
 * Search for skills across databases using semantic vector search.
 * When scope is 'all', searches both global and project DBs and merges results.
 */
export async function searchSkills(
    globalDb: Database.Database,
    projectDb: Database.Database | null,
    query: string,
    options: SearchOptions = {}
): Promise<SearchResult[]> {
    const { topK = 5, scope = "all" } = options;

    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    let results: SearchResult[] = [];

    // Search global DB
    if (scope === "all" || scope === "global") {
        const globalResults = searchInDb(globalDb, queryEmbedding, topK);
        results.push(...globalResults);
    }

    // Search project DB
    if (projectDb && (scope === "all" || scope === "project")) {
        const projectResults = searchInDb(projectDb, queryEmbedding, topK);
        results.push(...projectResults);
    }

    // Sort by relevance score (higher is better) and deduplicate by name
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Deduplicate: keep the highest-scoring entry for each name
    const seen = new Set<string>();
    results = results.filter((r) => {
        if (seen.has(r.name)) return false;
        seen.add(r.name);
        return true;
    });

    return results.slice(0, topK);
}

/**
 * Search within a single database
 */
function searchInDb(
    db: Database.Database,
    queryEmbedding: Float32Array,
    topK: number
): SearchResult[] {
    const vectorResults = searchByVector(db, queryEmbedding, topK);

    const results: SearchResult[] = [];

    for (const vr of vectorResults) {
        const skill = getSkillById(db, vr.skillId);
        if (!skill) continue;

        // Convert distance to a similarity score (0-1, higher is better)
        // sqlite-vec uses L2 distance by default, so lower distance = more similar
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
    globalDb: Database.Database,
    projectDb: Database.Database | null,
    scope?: "all" | "global" | "project",
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
        const globalSkills = getAllSkills(globalDb, "global", tag);
        results.push(...globalSkills.map(mapRecord));
    }

    if (projectDb && (!scope || scope === "all" || scope === "project")) {
        const projectSkills = getAllSkills(projectDb, "project", tag);
        results.push(...projectSkills.map(mapRecord));
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
}
