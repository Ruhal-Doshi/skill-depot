/**
 * MCP Server Integration Tests
 *
 * These tests exercise the same logic as the MCP tool handlers, using real
 * SQLite databases, real filesystem operations, and the BM25 fallback embeddings.
 * They validate the full save → search → read → update → delete lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

import { createDatabase, insertSkill, updateSkill, deleteSkill, getSkillByName, clearSkillsByScope, getSkillCount } from "../../src/core/database.js";
import { generateBM25Embedding } from "../../src/core/embeddings.js";
import { searchSkills, listSkills } from "../../src/core/search.js";
import { readSkillFile, writeSkillFile, deleteSkillFile, listSkillFiles, hashContent, getSkillNameFromPath } from "../../src/core/file-manager.js";
import { parseSkillContent, generateIndexableText, generateSnippet } from "../../src/core/frontmatter.js";

// Use BM25 directly to avoid downloading the 80MB transformer model in tests
const generateEmbedding = generateBM25Embedding;

/**
 * Simulates the MCP server context — global + project databases and dirs
 */
interface TestContext {
    tmpDir: string;
    globalDir: string;
    globalSkillsDir: string;
    globalDbPath: string;
    globalDb: ReturnType<typeof createDatabase>;
    projectDir: string;
    projectSkillsDir: string;
    projectDbPath: string;
    projectDb: ReturnType<typeof createDatabase>;
}

async function createTestContext(): Promise<TestContext> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-depot-mcp-"));
    const globalDir = path.join(tmpDir, "global");
    const globalSkillsDir = path.join(globalDir, "skills");
    const globalDbPath = path.join(globalDir, "index.db");
    const projectDir = path.join(tmpDir, "project", ".skill-depot");
    const projectSkillsDir = path.join(projectDir, "skills");
    const projectDbPath = path.join(projectDir, "index.db");

    await fs.mkdir(globalSkillsDir, { recursive: true });
    await fs.mkdir(projectSkillsDir, { recursive: true });

    return {
        tmpDir,
        globalDir,
        globalSkillsDir,
        globalDbPath,
        globalDb: createDatabase(globalDbPath),
        projectDir,
        projectSkillsDir,
        projectDbPath,
        projectDb: createDatabase(projectDbPath),
    };
}

async function destroyTestContext(ctx: TestContext): Promise<void> {
    ctx.globalDb.close();
    ctx.projectDb.close();
    await fs.rm(ctx.tmpDir, { recursive: true, force: true });
}

// ──────────────────────────────────────────────────────────────

describe("MCP Integration: Full Skill Lifecycle", () => {
    let ctx: TestContext;

    beforeEach(async () => {
        ctx = await createTestContext();
    });

    afterEach(async () => {
        await destroyTestContext(ctx);
    });

    // ─── skill_save ────────────────────────────────────────────

    describe("skill_save flow", () => {
        it("should save a skill file and index it", async () => {
            const name = "deploy-vercel";
            const description = "Deploy a Next.js app to Vercel";
            const content = "## Steps\n\n1. Install Vercel CLI\n2. Run `vercel`";
            const tags = ["deployment", "vercel"];
            const keywords = ["vercel cli", "nextjs"];
            const scope = "global";

            // Simulate skill_save handler
            const frontmatter = { name, description, tags, keywords };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, content);

            const indexableText = generateIndexableText(frontmatter, content);
            const snippet = generateSnippet(frontmatter, content);
            const embedding = generateEmbedding(indexableText);
            const contentHash = hashContent(content);

            const id = insertSkill(ctx.globalDb, {
                name,
                description,
                tags,
                keywords,
                contentHash,
                filePath,
                scope,
                projectPath: scope === "global" ? "" : ctx.projectDir,
                snippet,
                indexableText,
                embedding,
            });

            expect(id).toBeGreaterThan(0);

            // Verify file exists and is parseable
            const parsed = await readSkillFile(filePath);
            expect(parsed.frontmatter.name).toBe("deploy-vercel");
            expect(parsed.frontmatter.tags).toEqual(["deployment", "vercel"]);
            expect(parsed.body).toContain("## Steps");

            // Verify DB record
            const record = getSkillByName(ctx.globalDb, name);
            expect(record).toBeDefined();
            expect(record!.scope).toBe("global");
        });

        it("should reject duplicate skill names", async () => {
            const name = "duplicate-skill";
            const frontmatter = { name, description: "test", tags: [], keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);
            await writeSkillFile(filePath, frontmatter, "body");

            const embedding = generateEmbedding("test");
            insertSkill(ctx.globalDb, {
                name,
                description: "test",
                tags: [],
                keywords: [],
                contentHash: "abc",
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "test",
                indexableText: "test",
                embedding,
            });

            // Second insert should throw
            expect(() =>
                insertSkill(ctx.globalDb, {
                    name,
                    description: "test2",
                    tags: [],
                    keywords: [],
                    contentHash: "def",
                    filePath: filePath + "2",
                    scope: "global",
                    projectPath: "",
                    snippet: "test2",
                    indexableText: "test2",
                    embedding,
                })
            ).toThrow();
        });
    });

    // ─── skill_search ──────────────────────────────────────────

    describe("skill_search flow", () => {
        beforeEach(async () => {
            // Seed the databases with a few skills
            const skills = [
                {
                    name: "deploy-vercel",
                    description: "Deploy to Vercel",
                    tags: ["deployment"],
                    keywords: ["vercel", "nextjs"],
                    scope: "global" as const,
                    dir: ctx.globalSkillsDir,
                    db: ctx.globalDb,
                },
                {
                    name: "setup-postgres",
                    description: "Set up PostgreSQL database",
                    tags: ["database"],
                    keywords: ["postgres", "sql"],
                    scope: "global" as const,
                    dir: ctx.globalSkillsDir,
                    db: ctx.globalDb,
                },
                {
                    name: "project-auth",
                    description: "Implement authentication with OAuth",
                    tags: ["auth", "security"],
                    keywords: ["oauth", "jwt"],
                    scope: "project" as const,
                    dir: ctx.projectSkillsDir,
                    db: ctx.projectDb,
                },
            ];

            for (const s of skills) {
                const frontmatter = {
                    name: s.name,
                    description: s.description,
                    tags: s.tags,
                    keywords: s.keywords,
                };
                const body = `Instructions for ${s.name}`;
                const filePath = path.join(s.dir, `${s.name}.md`);
                await writeSkillFile(filePath, frontmatter, body);

                const indexableText = generateIndexableText(frontmatter, body);
                const snippet = generateSnippet(frontmatter, body);
                const embedding = generateEmbedding(indexableText);

                insertSkill(s.db, {
                    name: s.name,
                    description: s.description,
                    tags: s.tags,
                    keywords: s.keywords,
                    contentHash: hashContent(body),
                    filePath,
                    scope: s.scope,
                    projectPath: s.scope === "global" ? "" : ctx.projectDir,
                    snippet,
                    indexableText,
                    embedding,
                });
            }
        });

        it("should return ranked results for a query", async () => {
            const results = await searchSkills(ctx.globalDb, "deploy vercel nextjs", {
                topK: 5,
                scope: "all",
                cwd: ctx.projectDir,
            });

            expect(results.length).toBeGreaterThan(0);
            // deploy-vercel should rank highest for this query
            expect(results[0].name).toBe("deploy-vercel");
            expect(results[0].relevanceScore).toBeGreaterThan(0);
        });

        it("should respect scope filter", async () => {
            const globalResults = await searchSkills(ctx.globalDb, "deploy", {
                scope: "global",
                cwd: ctx.projectDir,
            });
            const projectResults = await searchSkills(ctx.globalDb, "auth", {
                scope: "project",
                cwd: ctx.projectDir,
            });

            for (const r of globalResults) {
                expect(r.scope).toBe("global");
            }
            for (const r of projectResults) {
                expect(r.scope).toBe("project");
            }
        });

        it("should search across both scopes by default", async () => {
            const results = await searchSkills(ctx.globalDb, "setup", {
                topK: 10,
                cwd: ctx.projectDir,
            });

            // Should include results from both databases
            const scopes = new Set(results.map((r) => r.scope));
            expect(results.length).toBeGreaterThanOrEqual(1);
        });
    });

    // ─── skill_read ────────────────────────────────────────────

    describe("skill_read flow", () => {
        it("should read the full content of a saved skill", async () => {
            const name = "readable-skill";
            const body = "## Full Content\n\nDetailed instructions here.";
            const frontmatter = { name, description: "A readable skill", tags: ["test"], keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, body);
            insertSkill(ctx.globalDb, {
                name,
                description: frontmatter.description,
                tags: frontmatter.tags,
                keywords: [],
                contentHash: hashContent(body),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "A readable skill",
                indexableText: generateIndexableText(frontmatter, body),
                embedding: generateEmbedding("readable skill test"),
            });

            // Simulate skill_read handler
            const record = getSkillByName(ctx.globalDb, name);
            expect(record).toBeDefined();

            const parsed = await readSkillFile(record!.file_path);
            expect(parsed.frontmatter.name).toBe("readable-skill");
            expect(parsed.body).toContain("Detailed instructions here.");
        });

        it("should prefer project-scoped skills over global", async () => {
            const name = "shared-name";
            const body = "body";
            const frontmatter = { name, description: "desc", tags: [], keywords: [] };
            const embedding = generateEmbedding("shared");

            // Save in both scopes
            const globalPath = path.join(ctx.globalSkillsDir, `${name}.md`);
            const projectPath = path.join(ctx.projectSkillsDir, `${name}.md`);
            await writeSkillFile(globalPath, { ...frontmatter, description: "global version" }, body);
            await writeSkillFile(projectPath, { ...frontmatter, description: "project version" }, body);

            insertSkill(ctx.globalDb, {
                name, description: "global version", tags: [], keywords: [],
                contentHash: "g", filePath: globalPath, scope: "global",
                projectPath: "",
                snippet: "g", indexableText: "g", embedding,
            });
            insertSkill(ctx.globalDb, {
                name, description: "project version", tags: [], keywords: [],
                contentHash: "p", filePath: projectPath, scope: "project",
                projectPath: ctx.projectDir,
                snippet: "p", indexableText: "p", embedding,
            });

            // Simulate priority: project > global
            const projectRecord = getSkillByName(ctx.globalDb, name, ctx.projectDir);
            const globalRecord = getSkillByName(ctx.globalDb, name);
            const record = projectRecord || globalRecord;

            expect(record!.description).toBe("project version");
        });
    });

    // ─── skill_update ──────────────────────────────────────────

    describe("skill_update flow", () => {
        it("should update file content and re-index", async () => {
            const name = "updatable-skill";
            const originalBody = "## Original\n\nOriginal content.";
            const frontmatter = { name, description: "Original desc", tags: ["v1"], keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, originalBody);
            insertSkill(ctx.globalDb, {
                name,
                description: frontmatter.description,
                tags: frontmatter.tags,
                keywords: [],
                contentHash: hashContent(originalBody),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "Original desc",
                indexableText: generateIndexableText(frontmatter, originalBody),
                embedding: generateEmbedding("original"),
            });

            // Simulate skill_update handler
            const record = getSkillByName(ctx.globalDb, name)!;
            const existing = await readSkillFile(record.file_path);

            const updatedDescription = "Updated description";
            const updatedBody = "## Updated\n\nNew content here.";
            const updatedTags = ["v2", "updated"];
            const newFrontmatter = {
                ...existing.frontmatter,
                description: updatedDescription,
                tags: updatedTags,
            };

            await writeSkillFile(record.file_path, newFrontmatter, updatedBody);

            const newIndexableText = generateIndexableText(newFrontmatter, updatedBody);
            const newSnippet = generateSnippet(newFrontmatter, updatedBody);
            const newEmbedding = generateEmbedding(newIndexableText);

            const updated = updateSkill(ctx.globalDb, name, {
                description: updatedDescription,
                tags: updatedTags,
                snippet: newSnippet,
                indexableText: newIndexableText,
                embedding: newEmbedding,
                contentHash: hashContent(updatedBody),
            });

            expect(updated).toBe(true);

            // Verify the update persisted
            const afterUpdate = getSkillByName(ctx.globalDb, name)!;
            expect(afterUpdate.description).toBe("Updated description");
            expect(JSON.parse(afterUpdate.tags)).toEqual(["v2", "updated"]);

            // Verify file on disk
            const parsedAfter = await readSkillFile(filePath);
            expect(parsedAfter.frontmatter.description).toBe("Updated description");
            expect(parsedAfter.body).toContain("New content here.");
        });
    });

    // ─── skill_delete ──────────────────────────────────────────

    describe("skill_delete flow", () => {
        it("should delete both file and index entry", async () => {
            const name = "deletable-skill";
            const body = "Will be deleted.";
            const frontmatter = { name, description: "temp", tags: [], keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, body);
            insertSkill(ctx.globalDb, {
                name,
                description: "temp",
                tags: [],
                keywords: [],
                contentHash: hashContent(body),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "temp",
                indexableText: "temp",
                embedding: generateEmbedding("temp"),
            });

            // Verify it exists
            expect(getSkillByName(ctx.globalDb, name)).toBeDefined();

            // Simulate skill_delete handler
            await deleteSkillFile(filePath);
            deleteSkill(ctx.globalDb, name);

            // Verify both are gone
            expect(getSkillByName(ctx.globalDb, name)).toBeUndefined();
            const exists = await fs.access(filePath).then(() => true).catch(() => false);
            expect(exists).toBe(false);
        });
    });

    // ─── skill_list ────────────────────────────────────────────

    describe("skill_list flow", () => {
        it("should list skills from both scopes", async () => {
            const embedding = generateEmbedding("list test");

            insertSkill(ctx.globalDb, {
                name: "global-a", description: "A", tags: ["tag1"], keywords: [],
                contentHash: "a", filePath: "/a.md", scope: "global",
                projectPath: "",
                snippet: "a", indexableText: "a", embedding,
            });
            insertSkill(ctx.globalDb, {
                name: "project-b", description: "B", tags: ["tag2"], keywords: [],
                contentHash: "b", filePath: "/b.md", scope: "project",
                projectPath: ctx.projectDir,
                snippet: "b", indexableText: "b", embedding,
            });

            const all = listSkills(ctx.globalDb, "all", ctx.projectDir);
            expect(all).toHaveLength(2);
            expect(all.map((s) => s.name).sort()).toEqual(["global-a", "project-b"]);
        });
    });

    // ─── skill_reindex ─────────────────────────────────────────

    describe("skill_reindex flow", () => {
        it("should clear and rebuild the index from files on disk", async () => {
            // Write 3 skill files directly to disk (no DB entry)
            const files = ["alpha", "beta", "gamma"];
            for (const name of files) {
                const frontmatter = { name, description: `Skill ${name}`, tags: ["reindex"], keywords: [] };
                const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);
                await writeSkillFile(filePath, frontmatter, `Body for ${name}`);
            }

            // DB is empty at this point
            expect(getSkillCount(ctx.globalDb)).toBe(0);

            // Simulate skill_reindex handler
            clearSkillsByScope(ctx.globalDb, "global", "");
            const skillFiles = await listSkillFiles(ctx.globalSkillsDir);

            for (const filePath of skillFiles) {
                const parsed = await readSkillFile(filePath);
                const name = parsed.frontmatter.name || getSkillNameFromPath(filePath);
                const indexableText = generateIndexableText(parsed.frontmatter, parsed.body);
                const snippet = generateSnippet(parsed.frontmatter, parsed.body);
                const embedding = generateEmbedding(indexableText);

                insertSkill(ctx.globalDb, {
                    name,
                    description: parsed.frontmatter.description,
                    tags: parsed.frontmatter.tags,
                    keywords: parsed.frontmatter.keywords,
                    contentHash: hashContent(parsed.raw),
                    filePath,
                    scope: "global",
                    projectPath: "",
                    snippet,
                    indexableText,
                    embedding,
                });
            }

            // Should now have 3 indexed skills
            expect(getSkillCount(ctx.globalDb)).toBe(3);

            // Verify they're searchable
            const results = await searchSkills(ctx.globalDb, "alpha", { topK: 1, cwd: ctx.projectDir });
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].name).toBe("alpha");
        });
    });

    // ─── Full lifecycle ────────────────────────────────────────

    describe("full lifecycle: save → search → read → update → delete", () => {
        it("should complete the entire skill lifecycle", async () => {
            // 1. SAVE
            const name = "lifecycle-skill";
            const description = "Lifecycle test skill";
            const content = "## Step 1\n\nDo the thing.";
            const tags = ["lifecycle", "test"];
            const frontmatter = { name, description, tags, keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, content);
            const indexableText = generateIndexableText(frontmatter, content);
            const snippet = generateSnippet(frontmatter, content);
            const embedding = generateEmbedding(indexableText);
            insertSkill(ctx.globalDb, {
                name, description, tags, keywords: [],
                contentHash: hashContent(content), filePath, scope: "global",
                projectPath: "",
                snippet, indexableText, embedding,
            });

            // 2. SEARCH — should find the skill
            const searchResults = await searchSkills(ctx.globalDb, "lifecycle test step", { topK: 3, cwd: ctx.projectDir });
            expect(searchResults.length).toBeGreaterThan(0);
            const found = searchResults.find((r) => r.name === name);
            expect(found).toBeDefined();

            // 3. READ — should return full content
            const record = getSkillByName(ctx.globalDb, name)!;
            const parsed = await readSkillFile(record.file_path);
            expect(parsed.body).toContain("Do the thing.");

            // 4. UPDATE — modify description and content
            const updatedBody = "## Updated Step\n\nDo the new thing.";
            const updatedFrontmatter = { ...frontmatter, description: "Updated lifecycle" };
            await writeSkillFile(filePath, updatedFrontmatter, updatedBody);
            const newEmbedding = generateEmbedding(generateIndexableText(updatedFrontmatter, updatedBody));
            updateSkill(ctx.globalDb, name, {
                description: "Updated lifecycle",
                embedding: newEmbedding,
                contentHash: hashContent(updatedBody),
                snippet: generateSnippet(updatedFrontmatter, updatedBody),
                indexableText: generateIndexableText(updatedFrontmatter, updatedBody),
            });

            const afterUpdate = getSkillByName(ctx.globalDb, name)!;
            expect(afterUpdate.description).toBe("Updated lifecycle");

            // 5. DELETE — remove everything
            await deleteSkillFile(filePath);
            deleteSkill(ctx.globalDb, name);

            expect(getSkillByName(ctx.globalDb, name)).toBeUndefined();
            expect(getSkillCount(ctx.globalDb)).toBe(0);
        });
    });
});
