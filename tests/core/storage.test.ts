import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
    getProjectPaths,
    getSkillFilePath,
    ensureProjectDirs,
    isProjectInitialized,
} from "../../src/core/storage.js";

describe("storage", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-depot-storage-"));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe("getProjectPaths", () => {
        it("should return correct project paths", () => {
            const paths = getProjectPaths("/my/project");
            expect(paths.projectDir).toBe("/my/project/.skill-depot");
            expect(paths.projectSkillsDir).toBe("/my/project/.skill-depot/skills");
        });
    });

    describe("getSkillFilePath", () => {
        it("should return correct path for project-scoped skill", () => {
            const filePath = getSkillFilePath("deploy-vercel", "project", "/my/project");
            expect(filePath).toBe("/my/project/.skill-depot/skills/deploy-vercel.md");
        });

        it("should handle names that already end with .md", () => {
            const filePath = getSkillFilePath("deploy.md", "project", "/my/project");
            expect(filePath).toBe("/my/project/.skill-depot/skills/deploy.md");
        });

        it("should throw for project scope without projectRoot", () => {
            expect(() => getSkillFilePath("test", "project")).toThrow(
                "projectRoot is required"
            );
        });
    });

    describe("ensureProjectDirs", () => {
        it("should create project directory structure", async () => {
            await ensureProjectDirs(tmpDir);

            const skillsDir = path.join(tmpDir, ".skill-depot", "skills");
            const stat = await fs.stat(skillsDir);
            expect(stat.isDirectory()).toBe(true);
        });
    });

    describe("isProjectInitialized", () => {
        it("should return false for uninitialized project", () => {
            expect(isProjectInitialized(tmpDir)).toBe(false);
        });

        it("should return true after init", async () => {
            await ensureProjectDirs(tmpDir);
            expect(isProjectInitialized(tmpDir)).toBe(true);
        });
    });
});
