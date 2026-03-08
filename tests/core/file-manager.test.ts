import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
    readSkillFile,
    writeSkillFile,
    deleteSkillFile,
    hashContent,
    fileExists,
    copySkillFile,
    listSkillFiles,
    getSkillNameFromPath,
} from "../../src/core/file-manager.js";

describe("file-manager", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-depot-test-"));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe("writeSkillFile + readSkillFile", () => {
        it("should write and read a skill file round-trip", async () => {
            const filePath = path.join(tmpDir, "test-skill.md");
            const frontmatter = {
                name: "test-skill",
                description: "A test skill",
                tags: ["testing"],
                keywords: ["unit"],
            };
            const body = "## Steps\n\n1. Do the thing";

            await writeSkillFile(filePath, frontmatter, body);

            expect(fileExists(filePath)).toBe(true);

            const parsed = await readSkillFile(filePath);
            expect(parsed.frontmatter.name).toBe("test-skill");
            expect(parsed.frontmatter.description).toBe("A test skill");
            expect(parsed.frontmatter.tags).toEqual(["testing"]);
            expect(parsed.body).toContain("## Steps");
        });

        it("should create nested directories", async () => {
            const filePath = path.join(tmpDir, "nested", "dir", "skill.md");
            await writeSkillFile(
                filePath,
                { name: "nested", description: "", tags: [], keywords: [] },
                "Body"
            );

            expect(fileExists(filePath)).toBe(true);
        });
    });

    describe("deleteSkillFile", () => {
        it("should delete an existing file", async () => {
            const filePath = path.join(tmpDir, "to-delete.md");
            await fs.writeFile(filePath, "content", "utf-8");

            const result = await deleteSkillFile(filePath);
            expect(result).toBe(true);
            expect(fileExists(filePath)).toBe(false);
        });

        it("should return false for non-existent file", async () => {
            const result = await deleteSkillFile(path.join(tmpDir, "nope.md"));
            expect(result).toBe(false);
        });
    });

    describe("hashContent", () => {
        it("should return consistent hashes", () => {
            const hash1 = hashContent("hello world");
            const hash2 = hashContent("hello world");
            expect(hash1).toBe(hash2);
        });

        it("should return different hashes for different content", () => {
            const hash1 = hashContent("hello");
            const hash2 = hashContent("world");
            expect(hash1).not.toBe(hash2);
        });

        it("should return a 64-char hex string (SHA-256)", () => {
            const hash = hashContent("test");
            expect(hash).toMatch(/^[a-f0-9]{64}$/);
        });
    });

    describe("copySkillFile", () => {
        it("should copy a file to a new location", async () => {
            const src = path.join(tmpDir, "source.md");
            const dest = path.join(tmpDir, "dest", "copied.md");
            await fs.writeFile(src, "skill content", "utf-8");

            await copySkillFile(src, dest);

            expect(fileExists(dest)).toBe(true);
            const content = await fs.readFile(dest, "utf-8");
            expect(content).toBe("skill content");
        });
    });

    describe("listSkillFiles", () => {
        it("should list only .md files", async () => {
            await fs.writeFile(path.join(tmpDir, "skill1.md"), "s1");
            await fs.writeFile(path.join(tmpDir, "skill2.md"), "s2");
            await fs.writeFile(path.join(tmpDir, "readme.txt"), "r");

            const files = await listSkillFiles(tmpDir);
            expect(files).toHaveLength(2);
            expect(files.map((f) => path.basename(f)).sort()).toEqual([
                "skill1.md",
                "skill2.md",
            ]);
        });

        it("should recursively discover .md files in subdirectories", async () => {
            // Simulate: skills/deployment/vercel.md, skills/database/postgres.md
            await fs.mkdir(path.join(tmpDir, "deployment"), { recursive: true });
            await fs.mkdir(path.join(tmpDir, "database"), { recursive: true });
            await fs.writeFile(path.join(tmpDir, "top-level.md"), "top");
            await fs.writeFile(path.join(tmpDir, "deployment", "vercel.md"), "v");
            await fs.writeFile(path.join(tmpDir, "deployment", "aws.md"), "a");
            await fs.writeFile(path.join(tmpDir, "database", "postgres.md"), "p");
            await fs.writeFile(path.join(tmpDir, "database", "notes.txt"), "skip");

            const files = await listSkillFiles(tmpDir);
            expect(files).toHaveLength(4);
            expect(files.map((f) => path.basename(f)).sort()).toEqual([
                "aws.md",
                "postgres.md",
                "top-level.md",
                "vercel.md",
            ]);
        });

        it("should handle deeply nested structures", async () => {
            await fs.mkdir(path.join(tmpDir, "a", "b", "c"), { recursive: true });
            await fs.writeFile(path.join(tmpDir, "a", "b", "c", "deep.md"), "d");

            const files = await listSkillFiles(tmpDir);
            expect(files).toHaveLength(1);
            expect(path.basename(files[0])).toBe("deep.md");
        });

        it("should return empty array for non-existent directory", async () => {
            const files = await listSkillFiles(path.join(tmpDir, "nope"));
            expect(files).toEqual([]);
        });
    });

    describe("getSkillNameFromPath", () => {
        it("should extract name without .md extension", () => {
            expect(getSkillNameFromPath("/path/to/deploy-vercel.md")).toBe("deploy-vercel");
        });

        it("should handle paths without .md extension", () => {
            expect(getSkillNameFromPath("/path/to/skill")).toBe("skill");
        });
    });
});
