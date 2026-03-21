import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
    createDatabase,
    insertSkill,
    incrementReadCount,
    type SkillInsert,
} from "../../src/core/database.js";
import { searchSkills, listSkills } from "../../src/core/search.js";
import { generateBM25Embedding } from "../../src/core/embeddings.js";

function makeEmbedding(seed: number = 0): Float32Array {
    const emb = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
        emb[i] = Math.sin(seed + i * 0.1);
    }
    let norm = 0;
    for (let i = 0; i < 384; i++) norm += emb[i] * emb[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < 384; i++) emb[i] /= norm;
    return emb;
}

function makeSkill(
    name: string,
    overrides: Partial<SkillInsert> = {}
): SkillInsert {
    return {
        name,
        description: `Description for ${name}`,
        tags: ["test"],
        keywords: [],
        contentHash: "abc",
        filePath: `/path/${name}.md`,
        scope: "global",
        projectPath: overrides.scope === "project" ? "/project/path" : "",
        snippet: `Snippet for ${name}`,
        overview: "",
        indexableText: `${name} test`,
        related: [],
        embedding: makeEmbedding(name.charCodeAt(0)),
        ...overrides,
    };
}

describe("search", () => {
    let tmpDir: string;
    let globalDbPath: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-depot-search-"));
        globalDbPath = path.join(tmpDir, "global.db");
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe("listSkills", () => {
        it("should list skills from both databases", () => {
            const globalDb = createDatabase(globalDbPath);

            insertSkill(globalDb, makeSkill("global-skill", { scope: "global" }));
            insertSkill(
                globalDb,
                makeSkill("project-skill", { scope: "project" })
            );

            const results = listSkills(globalDb, "all", "/project/path");

            expect(results).toHaveLength(2);
            expect(results.map((r) => r.name).sort()).toEqual([
                "global-skill",
                "project-skill",
            ]);

            globalDb.close();
        });

        it("should filter by scope", () => {
            const globalDb = createDatabase(globalDbPath);

            insertSkill(globalDb, makeSkill("global-1", { scope: "global" }));
            insertSkill(globalDb, makeSkill("project-1", { scope: "project" }));

            const globalOnly = listSkills(globalDb, "global", "/project/path");
            expect(globalOnly).toHaveLength(1);
            expect(globalOnly[0].name).toBe("global-1");

            const projectOnly = listSkills(globalDb, "project", "/project/path");
            expect(projectOnly).toHaveLength(1);
            expect(projectOnly[0].name).toBe("project-1");

            globalDb.close();
        });

        it("should return only global skills when out of project context", () => {
            const globalDb = createDatabase(globalDbPath);
            insertSkill(globalDb, makeSkill("only-global", { scope: "global" }));
            insertSkill(globalDb, makeSkill("only-project", { scope: "project" }));

            const results = listSkills(globalDb, "all", "/other/path");
            // It should only return global since the cwd doesn't match the project skill's path
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("only-global");

            globalDb.close();
        });

        it("should filter by tag", () => {
            const globalDb = createDatabase(globalDbPath);

            insertSkill(
                globalDb,
                makeSkill("vercel-deploy", {
                    scope: "global",
                    tags: ["deployment", "vercel"],
                })
            );
            insertSkill(
                globalDb,
                makeSkill("postgres-setup", {
                    scope: "global",
                    tags: ["database"],
                })
            );

            const results = listSkills(globalDb, "all", "/project/path", "deployment");
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("vercel-deploy");

            globalDb.close();
        });

        it("should return sorted results", () => {
            const globalDb = createDatabase(globalDbPath);

            insertSkill(globalDb, makeSkill("zebra", { scope: "global" }));
            insertSkill(globalDb, makeSkill("alpha", { scope: "global" }));
            insertSkill(globalDb, makeSkill("middle", { scope: "global" }));

            const results = listSkills(globalDb, "all", "/project/path");
            expect(results.map((r) => r.name)).toEqual([
                "alpha",
                "middle",
                "zebra",
            ]);

            globalDb.close();
        });
    });

    describe("searchSkills", () => {
        it("should set hasOverview true when overview is non-empty", async () => {
            const globalDb = createDatabase(globalDbPath);

            insertSkill(globalDb, makeSkill("with-overview", {
                scope: "global",
                overview: "## Setup\nInstall deps.",
                indexableText: "with-overview setup install",
                embedding: generateBM25Embedding("with-overview setup install"),
            }));

            const results = await searchSkills(globalDb, "setup install", {
                topK: 5,
                scope: "all",
            });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].hasOverview).toBe(true);

            globalDb.close();
        });

        it("should set hasOverview false when overview is empty", async () => {
            const globalDb = createDatabase(globalDbPath);

            insertSkill(globalDb, makeSkill("no-overview", {
                scope: "global",
                overview: "",
                indexableText: "no-overview plain skill",
                embedding: generateBM25Embedding("no-overview plain skill"),
            }));

            const results = await searchSkills(globalDb, "plain skill", {
                topK: 5,
                scope: "all",
            });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].hasOverview).toBe(false);

            globalDb.close();
        });

        it("should boost scores for frequently read skills", async () => {
            const globalDb = createDatabase(globalDbPath);

            // Insert two skills with identical embeddings so vector scores are equal
            const text = "deploy vercel nextjs application";
            const embedding = generateBM25Embedding(text);

            const id1 = insertSkill(globalDb, makeSkill("popular-skill", {
                scope: "global",
                indexableText: text,
                embedding,
            }));
            const id2 = insertSkill(globalDb, makeSkill("unpopular-skill", {
                scope: "global",
                indexableText: text,
                embedding,
            }));

            // Give the popular skill many reads
            for (let i = 0; i < 10; i++) {
                incrementReadCount(globalDb, id1);
            }

            const results = await searchSkills(globalDb, text, {
                topK: 5,
                scope: "all",
            });

            expect(results.length).toBe(2);
            const popular = results.find(r => r.name === "popular-skill")!;
            const unpopular = results.find(r => r.name === "unpopular-skill")!;
            expect(popular.relevanceScore).toBeGreaterThan(unpopular.relevanceScore);

            globalDb.close();
        });

        it("should use context to improve search relevance", async () => {
            const globalDb = createDatabase(globalDbPath);

            insertSkill(globalDb, makeSkill("deploy-vercel", {
                scope: "global",
                indexableText: "deploy vercel nextjs application frontend",
                embedding: generateBM25Embedding("deploy vercel nextjs application frontend"),
            }));
            insertSkill(globalDb, makeSkill("deploy-aws", {
                scope: "global",
                indexableText: "deploy aws ec2 lambda backend server",
                embedding: generateBM25Embedding("deploy aws ec2 lambda backend server"),
            }));

            // Without context, just "deploy" — both should appear
            const noContext = await searchSkills(globalDb, "deploy", {
                topK: 5,
                scope: "all",
            });
            expect(noContext.length).toBe(2);

            // With vercel-related context, vercel skill should rank first
            const withContext = await searchSkills(globalDb, "deploy", {
                topK: 5,
                scope: "all",
                context: "Working on a Next.js app with Vercel",
            });

            expect(withContext.length).toBe(2);
            expect(withContext[0].name).toBe("deploy-vercel");

            globalDb.close();
        });
    });
});
