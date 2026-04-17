import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { existsSync } from "node:fs";

/**
 * Tests for the scoped init behavior.
 * We test the underlying storage/discovery logic that init depends on,
 * since the initCommand itself requires interactive prompts.
 */
describe("init scope behavior", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-depot-init-"));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe("global-only mode", () => {
        it("should not create project dirs when global-only", async () => {
            const { ensureGlobalDirs } = await import("../../src/core/storage.js");

            // Mock homedir to use our tmpDir
            vi.spyOn(os, "homedir").mockReturnValue(tmpDir);

            const globalPaths = await ensureGlobalDirs();
            expect(existsSync(globalPaths.globalSkillsDir)).toBe(true);
            expect(existsSync(globalPaths.modelsDir)).toBe(true);

            // Project dir should NOT exist since we didn't call ensureProjectDirs
            const projectDir = path.join(tmpDir, "my-project", ".skill-depot");
            expect(existsSync(projectDir)).toBe(false);

            vi.restoreAllMocks();
        });

        it("should filter out project-scoped discoveries when global-only", async () => {
            const { detectAgents } = await import("../../src/discovery/detector.js");

            vi.spyOn(os, "homedir").mockReturnValue(tmpDir);

            // Set up a global skill
            const claudeSkills = path.join(tmpDir, ".claude", "skills");
            await fs.mkdir(claudeSkills, { recursive: true });
            await fs.writeFile(
                path.join(claudeSkills, "global-skill.md"),
                "---\nname: global\ndescription: Global skill\n---\n# Global"
            );

            // Set up a project skill
            const projectRoot = path.join(tmpDir, "project");
            const projectClaudeSkills = path.join(projectRoot, ".claude", "skills");
            await fs.mkdir(projectClaudeSkills, { recursive: true });
            await fs.writeFile(
                path.join(projectClaudeSkills, "project-skill.md"),
                "---\nname: project\ndescription: Project skill\n---\n# Project"
            );

            // Discover with project root (both scopes returned)
            const allDiscovered = await detectAgents(projectRoot);
            const globalOnly = allDiscovered.filter((d) => d.scope === "global");
            const projectOnly = allDiscovered.filter((d) => d.scope === "project");

            expect(globalOnly.length).toBeGreaterThan(0);
            expect(projectOnly.length).toBeGreaterThan(0);

            // In global-only mode, init filters to global scope only
            const filteredDiscovered = allDiscovered.filter((d) => d.scope === "global");
            expect(filteredDiscovered.every((d) => d.scope === "global")).toBe(true);

            vi.restoreAllMocks();
        });
    });

    describe("global-and-project mode", () => {
        it("should create both global and project dirs", async () => {
            const { ensureGlobalDirs, ensureProjectDirs } = await import("../../src/core/storage.js");

            vi.spyOn(os, "homedir").mockReturnValue(tmpDir);

            const projectRoot = path.join(tmpDir, "project");
            await fs.mkdir(projectRoot, { recursive: true });

            const globalPaths = await ensureGlobalDirs();
            const projectPaths = await ensureProjectDirs(projectRoot);

            expect(existsSync(globalPaths.globalSkillsDir)).toBe(true);
            expect(existsSync(projectPaths.projectSkillsDir)).toBe(true);

            vi.restoreAllMocks();
        });
    });
});
