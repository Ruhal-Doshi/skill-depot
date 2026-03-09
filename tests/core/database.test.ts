import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
    createDatabase,
    insertSkill,
    updateSkill,
    deleteSkill,
    getSkillByName,
    getSkillById,
    getAllSkills,
    searchByVector,
    clearSkillsByScope,
    getSkillCount,
    type SkillInsert,
} from "../../src/core/database.js";

function makeEmbedding(seed: number = 0): Float32Array {
    const emb = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
        emb[i] = Math.sin(seed + i * 0.1);
    }
    // L2 normalize
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
        keywords: ["testing"],
        contentHash: "abc123",
        filePath: `/path/to/${name}.md`,
        scope: "global",
        projectPath: overrides.scope === "project" ? "/project/path" : "",
        snippet: `Snippet for ${name}`,
        indexableText: `${name} test skill`,
        embedding: makeEmbedding(name.charCodeAt(0)),
        ...overrides,
    };
}

describe("database", () => {
    let dbPath: string;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-depot-db-"));
        dbPath = path.join(tmpDir, "test.db");
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe("createDatabase", () => {
        it("should create a database with the correct schema", () => {
            const db = createDatabase(dbPath);

            // Check that tables exist
            const tables = db
                .prepare(
                    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
                )
                .all() as Array<{ name: string }>;

            const tableNames = tables.map((t) => t.name);
            expect(tableNames).toContain("skills");
            expect(tableNames).toContain("skill_vectors");

            db.close();
        });

        it("should be idempotent (safe to call multiple times)", () => {
            const db1 = createDatabase(dbPath);
            db1.close();

            const db2 = createDatabase(dbPath);
            const count = getSkillCount(db2);
            expect(count).toBe(0);
            db2.close();
        });
    });

    describe("insertSkill", () => {
        it("should insert a skill and return its ID", () => {
            const db = createDatabase(dbPath);
            const skill = makeSkill("deploy-vercel");

            const id = insertSkill(db, skill);

            expect(id).toBeGreaterThan(0);

            const retrieved = getSkillByName(db, "deploy-vercel");
            expect(retrieved).toBeDefined();
            expect(retrieved!.name).toBe("deploy-vercel");
            expect(retrieved!.description).toBe("Description for deploy-vercel");
            expect(JSON.parse(retrieved!.tags)).toEqual(["test"]);
            expect(retrieved!.scope).toBe("global");

            db.close();
        });

        it("should accept duplicate skill names and update them", () => {
            const db = createDatabase(dbPath);
            insertSkill(db, makeSkill("duplicate", { description: "old desc" }));

            // Second insert should update the row instead of throwing
            const id = insertSkill(db, makeSkill("duplicate", { description: "new desc" }));
            expect(id).toBeGreaterThan(0);

            const record = getSkillByName(db, "duplicate");
            expect(record!.description).toBe("new desc");

            db.close();
        });
    });

    describe("updateSkill", () => {
        it("should update skill fields", () => {
            const db = createDatabase(dbPath);
            insertSkill(db, makeSkill("updatable"));

            const updated = updateSkill(db, "updatable", {
                description: "Updated description",
                tags: ["updated"],
            });

            expect(updated).toBe(true);

            const record = getSkillByName(db, "updatable");
            expect(record!.description).toBe("Updated description");
            expect(JSON.parse(record!.tags)).toEqual(["updated"]);

            db.close();
        });

        it("should return false for non-existent skill", () => {
            const db = createDatabase(dbPath);
            const result = updateSkill(db, "nope", { description: "test" });
            expect(result).toBe(false);
            db.close();
        });

        it("should update the embedding vector", () => {
            const db = createDatabase(dbPath);
            insertSkill(db, makeSkill("vec-update"));

            const newEmbedding = makeEmbedding(999);
            const updated = updateSkill(db, "vec-update", { embedding: newEmbedding });
            expect(updated).toBe(true);

            // The update should work without errors — we verify via search
            const results = searchByVector(db, newEmbedding, 1);
            expect(results).toHaveLength(1);
            expect(results[0].distance).toBeCloseTo(0, 1); // Should be very close

            db.close();
        });
    });

    describe("deleteSkill", () => {
        it("should delete an existing skill", () => {
            const db = createDatabase(dbPath);
            insertSkill(db, makeSkill("to-delete"));

            const deleted = deleteSkill(db, "to-delete");
            expect(deleted).toBe(true);
            expect(getSkillByName(db, "to-delete")).toBeUndefined();
            expect(getSkillCount(db)).toBe(0);

            db.close();
        });

        it("should return false for non-existent skill", () => {
            const db = createDatabase(dbPath);
            expect(deleteSkill(db, "nope")).toBe(false);
            db.close();
        });
    });

    describe("getAllSkills", () => {
        it("should return all skills", () => {
            const db = createDatabase(dbPath);
            insertSkill(db, makeSkill("skill-a"));
            insertSkill(db, makeSkill("skill-b"));
            insertSkill(db, makeSkill("skill-c", { scope: "project" }));

            const all = getAllSkills(db);
            expect(all).toHaveLength(3);

            db.close();
        });

        it("should filter by scope", () => {
            const db = createDatabase(dbPath);
            insertSkill(db, makeSkill("global-1"));
            insertSkill(db, makeSkill("project-1", { scope: "project" }));

            const globalOnly = getAllSkills(db, "global");
            expect(globalOnly).toHaveLength(1);
            expect(globalOnly[0].name).toBe("global-1");

            db.close();
        });

        it("should filter by tag", () => {
            const db = createDatabase(dbPath);
            insertSkill(db, makeSkill("tagged", { tags: ["deployment", "vercel"] }));
            insertSkill(db, makeSkill("untagged", { tags: ["other"] }));

            const filtered = getAllSkills(db, undefined, undefined, "deployment");
            expect(filtered).toHaveLength(1);
            expect(filtered[0].name).toBe("tagged");

            db.close();
        });
    });

    describe("searchByVector", () => {
        it("should return nearest neighbors ordered by distance", () => {
            const db = createDatabase(dbPath);

            // Insert skills with different embeddings
            insertSkill(db, makeSkill("close", { embedding: makeEmbedding(1) }));
            insertSkill(db, makeSkill("medium", { embedding: makeEmbedding(50) }));
            insertSkill(db, makeSkill("far", { embedding: makeEmbedding(200) }));

            // Search with an embedding close to seed=1
            const query = makeEmbedding(2);
            const results = searchByVector(db, query, 3);

            expect(results).toHaveLength(3);
            // First result should be "close" (seed=1 vs query seed=2)
            const closestSkill = getSkillById(db, results[0].skillId);
            expect(closestSkill!.name).toBe("close");
            // Distances should be ascending
            expect(results[0].distance).toBeLessThanOrEqual(results[1].distance);
            expect(results[1].distance).toBeLessThanOrEqual(results[2].distance);

            db.close();
        });

        it("should respect topK limit", () => {
            const db = createDatabase(dbPath);
            for (let i = 0; i < 10; i++) {
                insertSkill(db, makeSkill(`skill-${i}`, { embedding: makeEmbedding(i) }));
            }

            const results = searchByVector(db, makeEmbedding(0), 3);
            expect(results).toHaveLength(3);

            db.close();
        });

        it("should return empty array when no skills indexed", () => {
            const db = createDatabase(dbPath);
            const results = searchByVector(db, makeEmbedding(0), 5);
            expect(results).toEqual([]);
            db.close();
        });
    });

    describe("clearSkillsByScope", () => {
        it("should remove all skills and vectors", () => {
            const db = createDatabase(dbPath);
            insertSkill(db, makeSkill("a"));
            insertSkill(db, makeSkill("b"));
            expect(getSkillCount(db)).toBe(2);

            clearSkillsByScope(db, "global");

            expect(getSkillCount(db)).toBe(0);
            expect(getAllSkills(db)).toEqual([]);

            db.close();
        });
    });
});
