import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import Database from "better-sqlite3";

import { createDatabase, insertSkill, updateSkill, deleteSkill, getSkillByName, clearAllSkills } from "../core/database.js";
import { generateEmbedding } from "../core/embeddings.js";
import { searchSkills, listSkills } from "../core/search.js";
import { readSkillFile, writeSkillFile, deleteSkillFile, listSkillFiles, hashContent, getSkillNameFromPath } from "../core/file-manager.js";
import { parseSkillContent, generateIndexableText, generateSnippet } from "../core/frontmatter.js";
import { getGlobalPaths, getProjectPaths, ensureGlobalDirs, ensureProjectDirs, getSkillFilePath } from "../core/storage.js";
import { VERSION } from "../utils/version.js";

interface ServerContext {
    globalDb: Database.Database;
    projectDb: Database.Database | null;
    projectRoot: string | null;
}

/**
 * Create and configure the MCP server with all skill-depot tools
 */
export function createSkillDepotServer(projectRoot?: string): {
    server: McpServer;
    start: () => Promise<void>;
} {
    const mcpServer = new McpServer({
        name: "skill-depot",
        version: VERSION,
    });

    // Context will be initialized when the server starts
    let ctx: ServerContext;

    // ─── skill_search ─────────────────────────────────────────
    mcpServer.registerTool(
        "skill_search",
        {
            description:
                "Search for relevant skills using semantic search. Returns metadata and snippets — use skill_read for full content.",
            inputSchema: {
                query: z.string().describe("Search query describing the skill you need"),
                topK: z.number().optional().default(5).describe("Number of results to return (default: 5)"),
                scope: z.enum(["all", "global", "project"]).optional().default("all").describe("Search scope"),
            },
        },
        async ({ query, topK, scope }) => {
            const results = await searchSkills(ctx.globalDb, ctx.projectDb, query, {
                topK,
                scope,
            });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                results: results.map((r) => ({
                                    name: r.name,
                                    description: r.description,
                                    tags: r.tags,
                                    scope: r.scope,
                                    snippet: r.snippet,
                                    relevanceScore: Math.round(r.relevanceScore * 1000) / 1000,
                                })),
                                totalResults: results.length,
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }
    );

    // ─── skill_read ───────────────────────────────────────────
    mcpServer.registerTool(
        "skill_read",
        {
            description: "Read the full content of a skill by name.",
            inputSchema: {
                name: z.string().describe("Name of the skill to read"),
            },
        },
        async ({ name }) => {
            // Check both databases
            const globalRecord = getSkillByName(ctx.globalDb, name);
            const projectRecord = ctx.projectDb
                ? getSkillByName(ctx.projectDb, name)
                : null;

            const record = projectRecord || globalRecord;
            if (!record) {
                return {
                    content: [
                        { type: "text" as const, text: `Skill "${name}" not found.` },
                    ],
                    isError: true,
                };
            }

            try {
                const parsed = await readSkillFile(record.file_path);
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    name: record.name,
                                    scope: record.scope,
                                    filePath: record.file_path,
                                    content: parsed.raw,
                                },
                                null,
                                2
                            ),
                        },
                    ],
                };
            } catch {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Skill file not found at: ${record.file_path}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // ─── skill_save ───────────────────────────────────────────
    mcpServer.registerTool(
        "skill_save",
        {
            description:
                "Save a new skill. Writes the file and indexes it for search.",
            inputSchema: {
                name: z.string().describe("Unique name for the skill (used as filename)"),
                description: z.string().describe("Short description of what the skill does"),
                content: z.string().describe("Full markdown content of the skill (without frontmatter)"),
                scope: z.enum(["global", "project"]).default("global").describe("Where to save the skill"),
                tags: z.array(z.string()).optional().default([]).describe("Tags for categorization"),
                keywords: z.array(z.string()).optional().default([]).describe("Keywords to improve search relevance"),
            },
        },
        async ({ name, description, content, scope, tags, keywords }) => {
            const db = scope === "project" && ctx.projectDb ? ctx.projectDb : ctx.globalDb;
            const actualScope = scope === "project" && ctx.projectDb ? "project" : "global";

            // Check if skill already exists
            const existing = getSkillByName(db, name);
            if (existing) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Skill "${name}" already exists. Use skill_update to modify it.`,
                        },
                    ],
                    isError: true,
                };
            }

            const frontmatter = { name, description, tags: tags || [], keywords: keywords || [] };
            const filePath = getSkillFilePath(name, actualScope, ctx.projectRoot || undefined);

            // Write the file
            await writeSkillFile(filePath, frontmatter, content);

            // Generate embedding and index
            const indexableText = generateIndexableText(frontmatter, content);
            const snippet = generateSnippet(frontmatter, content);
            const embedding = await generateEmbedding(indexableText);
            const contentHash = hashContent(content);

            insertSkill(db, {
                name,
                description,
                tags: tags || [],
                keywords: keywords || [],
                contentHash,
                filePath,
                scope: actualScope,
                snippet,
                indexableText,
                embedding,
            });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({ filePath, indexed: true, scope: actualScope }, null, 2),
                    },
                ],
            };
        }
    );

    // ─── skill_update ─────────────────────────────────────────
    mcpServer.registerTool(
        "skill_update",
        {
            description: "Update an existing skill's content and re-index it.",
            inputSchema: {
                name: z.string().describe("Name of the skill to update"),
                content: z.string().optional().describe("New markdown content"),
                description: z.string().optional().describe("Updated description"),
                tags: z.array(z.string()).optional().describe("Updated tags"),
                keywords: z.array(z.string()).optional().describe("Updated keywords"),
            },
        },
        async ({ name, content, description, tags, keywords }) => {
            // Find the skill in either database
            const globalRecord = getSkillByName(ctx.globalDb, name);
            const projectRecord = ctx.projectDb ? getSkillByName(ctx.projectDb, name) : null;
            const record = projectRecord || globalRecord;
            const db = projectRecord ? ctx.projectDb! : ctx.globalDb;

            if (!record) {
                return {
                    content: [
                        { type: "text" as const, text: `Skill "${name}" not found.` },
                    ],
                    isError: true,
                };
            }

            // Read existing file
            const existing = await readSkillFile(record.file_path);
            const newFrontmatter = {
                ...existing.frontmatter,
                ...(description !== undefined ? { description } : {}),
                ...(tags !== undefined ? { tags } : {}),
                ...(keywords !== undefined ? { keywords } : {}),
            };
            const newBody = content !== undefined ? content : existing.body;

            // Write updated file
            await writeSkillFile(record.file_path, newFrontmatter, newBody);

            // Re-index
            const indexableText = generateIndexableText(newFrontmatter, newBody);
            const snippet = generateSnippet(newFrontmatter, newBody);
            const embedding = await generateEmbedding(indexableText);
            const contentHash = hashContent(newBody);

            updateSkill(db, name, {
                description: newFrontmatter.description,
                tags: newFrontmatter.tags,
                keywords: newFrontmatter.keywords,
                contentHash,
                snippet,
                indexableText,
                embedding,
            });

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({ filePath: record.file_path, reindexed: true }, null, 2),
                    },
                ],
            };
        }
    );

    // ─── skill_delete ─────────────────────────────────────────
    mcpServer.registerTool(
        "skill_delete",
        {
            description: "Delete a skill file and remove it from the index.",
            inputSchema: {
                name: z.string().describe("Name of the skill to delete"),
            },
        },
        async ({ name }) => {
            const globalRecord = getSkillByName(ctx.globalDb, name);
            const projectRecord = ctx.projectDb ? getSkillByName(ctx.projectDb, name) : null;
            const record = projectRecord || globalRecord;
            const db = projectRecord ? ctx.projectDb! : ctx.globalDb;

            if (!record) {
                return {
                    content: [
                        { type: "text" as const, text: `Skill "${name}" not found.` },
                    ],
                    isError: true,
                };
            }

            // Delete file and DB record
            await deleteSkillFile(record.file_path);
            deleteSkill(db, name);

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({ deleted: true, name }, null, 2),
                    },
                ],
            };
        }
    );

    // ─── skill_reindex ────────────────────────────────────────
    mcpServer.registerTool(
        "skill_reindex",
        {
            description: "Rebuild the search index by re-reading and re-embedding all skill files.",
            inputSchema: {
                scope: z.enum(["all", "global", "project"]).optional().default("all").describe("Which scope to reindex"),
            },
        },
        async ({ scope }) => {
            let indexed = 0;
            const errors: string[] = [];

            const reindexDb = async (
                db: Database.Database,
                skillsDir: string,
                dbScope: "global" | "project"
            ) => {
                // Clear existing data for this scope
                clearAllSkills(db);

                // List all skill files
                const files = await listSkillFiles(skillsDir);

                for (const filePath of files) {
                    try {
                        const parsed = await readSkillFile(filePath);
                        const name = parsed.frontmatter.name || getSkillNameFromPath(filePath);
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
                            scope: dbScope,
                            snippet,
                            indexableText,
                            embedding,
                        });
                        indexed++;
                    } catch (err) {
                        errors.push(`Failed to index ${filePath}: ${(err as Error).message}`);
                    }
                }
            };

            if (scope === "all" || scope === "global") {
                const { globalSkillsDir } = getGlobalPaths();
                await reindexDb(ctx.globalDb, globalSkillsDir, "global");
            }

            if (ctx.projectDb && ctx.projectRoot && (scope === "all" || scope === "project")) {
                const { projectSkillsDir } = getProjectPaths(ctx.projectRoot);
                await reindexDb(ctx.projectDb, projectSkillsDir, "project");
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify({ indexed, errors }, null, 2),
                    },
                ],
            };
        }
    );

    // ─── skill_list ───────────────────────────────────────────
    mcpServer.registerTool(
        "skill_list",
        {
            description: "List all indexed skills with optional filtering.",
            inputSchema: {
                scope: z.enum(["all", "global", "project"]).optional().default("all").describe("Filter by scope"),
                tag: z.string().optional().describe("Filter by tag"),
            },
        },
        async ({ scope, tag }) => {
            const results = listSkills(ctx.globalDb, ctx.projectDb, scope, tag);

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(
                            {
                                skills: results,
                                total: results.length,
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        }
    );

    // ─── Server start function ────────────────────────────────
    const start = async () => {
        // Initialize storage directories
        const globalPaths = await ensureGlobalDirs();
        const globalDb = createDatabase(globalPaths.globalDbPath);

        let projectDb: Database.Database | null = null;
        const resolvedProjectRoot = projectRoot || null;

        if (resolvedProjectRoot) {
            const projectPaths = await ensureProjectDirs(resolvedProjectRoot);
            projectDb = createDatabase(projectPaths.projectDbPath);
        }

        ctx = {
            globalDb,
            projectDb,
            projectRoot: resolvedProjectRoot,
        };

        // Connect via stdio
        const transport = new StdioServerTransport();
        await mcpServer.connect(transport);

        // Graceful shutdown
        process.on("SIGINT", () => {
            globalDb.close();
            projectDb?.close();
            process.exit(0);
        });

        process.on("SIGTERM", () => {
            globalDb.close();
            projectDb?.close();
            process.exit(0);
        });
    };

    return { server: mcpServer, start };
}
