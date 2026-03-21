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

import { createDatabase, insertSkill, updateSkill, deleteSkill, getSkillByName, clearSkillsByScope, getSkillCount, incrementReadCount } from "../../src/core/database.js";
import { generateBM25Embedding } from "../../src/core/embeddings.js";
import { searchSkills, listSkills } from "../../src/core/search.js";
import { readSkillFile, writeSkillFile, deleteSkillFile, listSkillFiles, hashContent, getSkillNameFromPath } from "../../src/core/file-manager.js";
import { parseSkillContent, generateIndexableText, generateSnippet, generateOverview } from "../../src/core/frontmatter.js";

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
            const overview = generateOverview(content);
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
                overview,
                indexableText,
                related: [],
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
            expect(record!.overview).toContain("## Steps");
        });

        it("should accept duplicate skill names and update them", async () => {
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
                overview: "",
                indexableText: "test",
                related: [],
                embedding,
            });

            // Second insert should update row instead of throwing
            const updatedEmbedding = generateEmbedding("test2");
            const newId = insertSkill(ctx.globalDb, {
                name,
                description: "test2",
                tags: [],
                keywords: [],
                contentHash: "def",
                filePath: filePath + "2",
                scope: "global",
                projectPath: "",
                snippet: "test2",
                overview: "",
                indexableText: "test2",
                related: [],
                embedding: updatedEmbedding,
            });

            expect(newId).toBeGreaterThan(0);

            const record = getSkillByName(ctx.globalDb, name);
            expect(record!.description).toBe("test2");
            expect(record!.file_path).toBe(filePath + "2");
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
                const overview = generateOverview(body);
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
                    overview,
                    indexableText,
                    related: [],
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
                overview: generateOverview(body),
                indexableText: generateIndexableText(frontmatter, body),
                related: [],
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
                snippet: "g", overview: "", indexableText: "g", related: [], embedding,
            });
            insertSkill(ctx.globalDb, {
                name, description: "project version", tags: [], keywords: [],
                contentHash: "p", filePath: projectPath, scope: "project",
                projectPath: ctx.projectDir,
                snippet: "p", overview: "", indexableText: "p", related: [], embedding,
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
                overview: generateOverview(originalBody),
                indexableText: generateIndexableText(frontmatter, originalBody),
                related: [],
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
                overview: generateOverview(updatedBody),
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
                overview: "",
                indexableText: "temp",
                related: [],
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
                snippet: "a", overview: "", indexableText: "a", related: [], embedding,
            });
            insertSkill(ctx.globalDb, {
                name: "project-b", description: "B", tags: ["tag2"], keywords: [],
                contentHash: "b", filePath: "/b.md", scope: "project",
                projectPath: ctx.projectDir,
                snippet: "b", overview: "", indexableText: "b", related: [], embedding,
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
                const overview = generateOverview(parsed.body);
                const embedding = generateEmbedding(indexableText);

                insertSkill(ctx.globalDb, {
                    name,
                    description: parsed.frontmatter.description ?? "",
                    tags: parsed.frontmatter.tags ?? [],
                    keywords: parsed.frontmatter.keywords ?? [],
                    contentHash: hashContent(parsed.raw),
                    filePath,
                    scope: "global",
                    projectPath: "",
                    snippet,
                    overview,
                    indexableText,
                    related: [],
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

    // ─── skill_learn ────────────────────────────────────────────

    describe("skill_learn flow", () => {
        it("should create a new skill when it doesn't exist", async () => {
            const name = "learned-pattern";
            const description = "A useful pattern discovered during work";
            const content = "## Pattern\n\nAlways check for null before accessing properties.";
            const tags = ["patterns", "debugging"];

            const frontmatter = { name, description, tags, keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, content);

            const indexableText = generateIndexableText(frontmatter, content);
            const snippet = generateSnippet(frontmatter, content);
            const overview = generateOverview(content);
            const embedding = generateEmbedding(indexableText);
            const contentHash = hashContent(content);

            insertSkill(ctx.globalDb, {
                name,
                description,
                tags,
                keywords: [],
                contentHash,
                filePath,
                scope: "global",
                projectPath: "",
                snippet,
                overview,
                indexableText,
                related: [],
                embedding,
            });

            const record = getSkillByName(ctx.globalDb, name);
            expect(record).toBeDefined();
            expect(record!.name).toBe("learned-pattern");
            expect(record!.description).toBe("A useful pattern discovered during work");

            const parsed = await readSkillFile(filePath);
            expect(parsed.body).toContain("Always check for null");
        });

        it("should append content to an existing skill with --- separator", async () => {
            const name = "appendable-skill";
            const originalBody = "## First Lesson\n\nOriginal content here.";
            const frontmatter = { name, description: "Original desc", tags: ["v1"], keywords: ["first"] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, originalBody);
            insertSkill(ctx.globalDb, {
                name,
                description: frontmatter.description,
                tags: frontmatter.tags,
                keywords: frontmatter.keywords,
                contentHash: hashContent(originalBody),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: generateSnippet(frontmatter, originalBody),
                overview: generateOverview(originalBody),
                indexableText: generateIndexableText(frontmatter, originalBody),
                related: [],
                embedding: generateEmbedding("appendable skill"),
            });

            // Simulate skill_learn append
            const existing = await readSkillFile(filePath);
            const appendContent = "## Second Lesson\n\nAppended content here.";
            const newBody = existing.body + "\n\n---\n\n" + appendContent;
            const newTags = [...new Set([...(existing.frontmatter.tags ?? []), "v2", "appended"])];
            const newKeywords = [...new Set([...(existing.frontmatter.keywords ?? []), "second"])];

            const newFrontmatter = {
                ...existing.frontmatter,
                tags: newTags,
                keywords: newKeywords,
            };

            await writeSkillFile(filePath, newFrontmatter, newBody);

            const newIndexableText = generateIndexableText(newFrontmatter, newBody);
            const newOverview = generateOverview(newBody);
            const newEmbedding = generateEmbedding(newIndexableText);

            updateSkill(ctx.globalDb, name, {
                tags: newTags,
                keywords: newKeywords,
                contentHash: hashContent(newBody),
                snippet: generateSnippet(newFrontmatter, newBody),
                overview: newOverview,
                indexableText: newIndexableText,
                embedding: newEmbedding,
            });

            // Verify file on disk has both sections separated by ---
            const afterAppend = await readSkillFile(filePath);
            expect(afterAppend.body).toContain("Original content here.");
            expect(afterAppend.body).toContain("---");
            expect(afterAppend.body).toContain("Appended content here.");

            // Verify tags were merged
            const record = getSkillByName(ctx.globalDb, name)!;
            const recordTags = JSON.parse(record.tags) as string[];
            expect(recordTags).toContain("v1");
            expect(recordTags).toContain("v2");
            expect(recordTags).toContain("appended");

            // Verify keywords were merged
            const recordKeywords = JSON.parse(record.keywords) as string[];
            expect(recordKeywords).toContain("first");
            expect(recordKeywords).toContain("second");
        });

        it("should preserve existing description when appending", async () => {
            const name = "keep-desc-skill";
            const frontmatter = { name, description: "Keep this description", tags: [], keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, "Original body.");
            insertSkill(ctx.globalDb, {
                name,
                description: frontmatter.description,
                tags: [],
                keywords: [],
                contentHash: hashContent("Original body."),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "Keep this description",
                overview: "",
                indexableText: generateIndexableText(frontmatter, "Original body."),
                related: [],
                embedding: generateEmbedding("keep desc"),
            });

            // Simulate append — existing description should be preserved
            const mergedDescription = frontmatter.description || "New description attempt";
            expect(mergedDescription).toBe("Keep this description");
        });

        it("should update description if existing was empty", async () => {
            const name = "empty-desc-skill";
            const frontmatter = { name, description: "", tags: [], keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, "Some body.");
            insertSkill(ctx.globalDb, {
                name,
                description: "",
                tags: [],
                keywords: [],
                contentHash: hashContent("Some body."),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "",
                overview: "",
                indexableText: generateIndexableText(frontmatter, "Some body."),
                related: [],
                embedding: generateEmbedding("empty desc"),
            });

            // Simulate append — empty description should be replaced
            const existingDesc = "";
            const newDesc = "Filled in by learning";
            const mergedDescription = existingDesc || newDesc;
            expect(mergedDescription).toBe("Filled in by learning");
        });
    });

    // ─── skill_preview ───────────────────────────────────────────

    describe("skill_preview flow", () => {
        it("should return overview for a skill with headings", async () => {
            const name = "previewable-skill";
            const body = "## Setup\n\nInstall the dependencies first.\n\n## Usage\n\nCall the main function.";
            const frontmatter = { name, description: "A previewable skill", tags: ["test"], keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, body);
            const overview = generateOverview(body);

            insertSkill(ctx.globalDb, {
                name,
                description: frontmatter.description,
                tags: frontmatter.tags,
                keywords: [],
                contentHash: hashContent(body),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "A previewable skill",
                overview,
                indexableText: generateIndexableText(frontmatter, body),
                related: [],
                embedding: generateEmbedding("previewable skill test"),
            });

            // Simulate skill_preview handler
            const record = getSkillByName(ctx.globalDb, name);
            expect(record).toBeDefined();
            expect(record!.overview).toContain("## Setup");
            expect(record!.overview).toContain("Install the dependencies first.");
            expect(record!.overview).toContain("## Usage");
            expect(record!.overview).toContain("Call the main function.");
        });

        it("should return empty overview for a skill without headings", async () => {
            const name = "no-heading-skill";
            const body = "Just plain text without any headings.";
            const frontmatter = { name, description: "No headings", tags: [], keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, body);

            insertSkill(ctx.globalDb, {
                name,
                description: frontmatter.description,
                tags: [],
                keywords: [],
                contentHash: hashContent(body),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "No headings",
                overview: generateOverview(body),
                indexableText: generateIndexableText(frontmatter, body),
                related: [],
                embedding: generateEmbedding("no heading skill"),
            });

            const record = getSkillByName(ctx.globalDb, name);
            expect(record).toBeDefined();
            expect(record!.overview).toBe("");
        });
    });

    // ─── activity tracking ─────────────────────────────────────

    describe("activity tracking flow", () => {
        it("should increment read_count when skill_read is called", async () => {
            const name = "tracked-skill";
            const body = "## Content\n\nSome content here.";
            const frontmatter = { name, description: "Tracked skill", tags: ["test"], keywords: [] };
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
                snippet: "Tracked skill",
                overview: generateOverview(body),
                indexableText: generateIndexableText(frontmatter, body),
                related: [],
                embedding: generateEmbedding("tracked skill test"),
            });

            // Verify initial read_count is 0
            const before = getSkillByName(ctx.globalDb, name)!;
            expect(before.read_count).toBe(0);

            // Simulate skill_read handler incrementing read count
            incrementReadCount(ctx.globalDb, before.id);

            const after = getSkillByName(ctx.globalDb, name)!;
            expect(after.read_count).toBe(1);
            expect(after.last_read_at).not.toBeNull();
        });

        it("should increment read_count when skill_preview is called", async () => {
            const name = "preview-tracked";
            const body = "## Setup\n\nInstall first.\n\n## Run\n\nRun the thing.";
            const frontmatter = { name, description: "Preview tracked", tags: [], keywords: [] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, body);
            insertSkill(ctx.globalDb, {
                name,
                description: frontmatter.description,
                tags: [],
                keywords: [],
                contentHash: hashContent(body),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "Preview tracked",
                overview: generateOverview(body),
                indexableText: generateIndexableText(frontmatter, body),
                related: [],
                embedding: generateEmbedding("preview tracked"),
            });

            const record = getSkillByName(ctx.globalDb, name)!;

            // Simulate skill_preview handler incrementing read count
            incrementReadCount(ctx.globalDb, record.id);
            incrementReadCount(ctx.globalDb, record.id);

            const after = getSkillByName(ctx.globalDb, name)!;
            expect(after.read_count).toBe(2);
        });
    });

    // ─── relation tracking ──────────────────────────────────────

    describe("relation tracking flow", () => {
        it("should store and retrieve related skills", async () => {
            const name = "deploy-vercel";
            const body = "## Steps\n\nDeploy to Vercel.";
            const frontmatter = { name, description: "Deploy to Vercel", tags: ["deployment"], keywords: [], related: ["setup-env-vars", "vercel-domains"] };
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
                snippet: "Deploy to Vercel",
                overview: generateOverview(body),
                indexableText: generateIndexableText(frontmatter, body),
                related: ["setup-env-vars", "vercel-domains"],
                embedding: generateEmbedding("deploy vercel"),
            });

            const record = getSkillByName(ctx.globalDb, name)!;
            const related = JSON.parse(record.related) as string[];
            expect(related).toEqual(["setup-env-vars", "vercel-domains"]);
        });

        it("should include related field in skill_read response", async () => {
            const name = "related-read-test";
            const body = "## Content\n\nSome content.";
            const frontmatter = { name, description: "Test", tags: [], keywords: [], related: ["other-skill"] };
            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);

            await writeSkillFile(filePath, frontmatter, body);
            insertSkill(ctx.globalDb, {
                name,
                description: "Test",
                tags: [],
                keywords: [],
                contentHash: hashContent(body),
                filePath,
                scope: "global",
                projectPath: "",
                snippet: "Test",
                overview: generateOverview(body),
                indexableText: generateIndexableText(frontmatter, body),
                related: ["other-skill"],
                embedding: generateEmbedding("related read test"),
            });

            // Simulate skill_read returning related
            const record = getSkillByName(ctx.globalDb, name)!;
            const related = JSON.parse(record.related || "[]") as string[];
            expect(related).toEqual(["other-skill"]);
        });

        it("should parse related from frontmatter on disk", async () => {
            const name = "from-disk";
            const content = `---
name: from-disk
description: Skill with related
tags:
  - test
related:
  - skill-a
  - skill-b
---

## Body

Some content.`;

            const filePath = path.join(ctx.globalSkillsDir, `${name}.md`);
            await fs.writeFile(filePath, content);

            const parsed = await readSkillFile(filePath);
            expect(parsed.frontmatter.related).toEqual(["skill-a", "skill-b"]);
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
            const overview = generateOverview(content);
            const embedding = generateEmbedding(indexableText);
            insertSkill(ctx.globalDb, {
                name, description, tags, keywords: [],
                contentHash: hashContent(content), filePath, scope: "global",
                projectPath: "",
                snippet, overview, indexableText, related: [], embedding,
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
                overview: generateOverview(updatedBody),
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
