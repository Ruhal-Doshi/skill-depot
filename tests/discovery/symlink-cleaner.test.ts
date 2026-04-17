import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { findAgentSymlinks, removeSymlinks } from "../../src/discovery/symlink-cleaner.js";

describe("symlink-cleaner", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-depot-symlink-"));
        vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe("findAgentSymlinks", () => {
        it("should find symlinks pointing to ~/.agents/skills/", async () => {
            const canonicalDir = path.join(tmpDir, ".agents", "skills", "my-skill");
            const cursorDir = path.join(tmpDir, ".cursor", "skills");
            const claudeDir = path.join(tmpDir, ".claude", "skills");

            await fs.mkdir(canonicalDir, { recursive: true });
            await fs.writeFile(path.join(canonicalDir, "SKILL.md"), "skill content");
            await fs.mkdir(cursorDir, { recursive: true });
            await fs.mkdir(claudeDir, { recursive: true });

            await fs.symlink(canonicalDir, path.join(cursorDir, "my-skill"));
            await fs.symlink(canonicalDir, path.join(claudeDir, "my-skill"));

            const symlinks = findAgentSymlinks();
            expect(symlinks).toHaveLength(2);
            expect(symlinks.map((s) => s.linkPath).sort()).toEqual([
                path.join(claudeDir, "my-skill"),
                path.join(cursorDir, "my-skill"),
            ]);
        });

        it("should ignore regular directories (not symlinks)", async () => {
            const cursorDir = path.join(tmpDir, ".cursor", "skills");
            await fs.mkdir(path.join(cursorDir, "regular-dir"), { recursive: true });
            await fs.writeFile(
                path.join(cursorDir, "regular-dir", "SKILL.md"),
                "content"
            );

            const symlinks = findAgentSymlinks();
            expect(symlinks).toHaveLength(0);
        });

        it("should ignore symlinks not pointing to ~/.agents/skills/", async () => {
            const cursorDir = path.join(tmpDir, ".cursor", "skills");
            const otherTarget = path.join(tmpDir, "other-place", "skill");

            await fs.mkdir(cursorDir, { recursive: true });
            await fs.mkdir(otherTarget, { recursive: true });
            await fs.symlink(otherTarget, path.join(cursorDir, "other-skill"));

            const symlinks = findAgentSymlinks();
            expect(symlinks).toHaveLength(0);
        });

        it("should return empty when no agent dirs exist", () => {
            const symlinks = findAgentSymlinks();
            expect(symlinks).toHaveLength(0);
        });
    });

    describe("removeSymlinks", () => {
        it("should remove symlinks and return the count", async () => {
            const canonicalDir = path.join(tmpDir, ".agents", "skills", "test-skill");
            const cursorDir = path.join(tmpDir, ".cursor", "skills");

            await fs.mkdir(canonicalDir, { recursive: true });
            await fs.mkdir(cursorDir, { recursive: true });

            const linkPath = path.join(cursorDir, "test-skill");
            await fs.symlink(canonicalDir, linkPath);

            const removed = await removeSymlinks([
                { linkPath, targetPath: canonicalDir },
            ]);
            expect(removed).toBe(1);

            const exists = await fs.access(linkPath).then(() => true).catch(() => false);
            expect(exists).toBe(false);
        });

        it("should handle already-removed symlinks gracefully", async () => {
            const removed = await removeSymlinks([
                { linkPath: path.join(tmpDir, "nonexistent"), targetPath: "/whatever" },
            ]);
            expect(removed).toBe(0);
        });

        it("should remove multiple symlinks", async () => {
            const canonicalDir = path.join(tmpDir, ".agents", "skills", "multi");
            const dir1 = path.join(tmpDir, ".cursor", "skills");
            const dir2 = path.join(tmpDir, ".claude", "skills");

            await fs.mkdir(canonicalDir, { recursive: true });
            await fs.mkdir(dir1, { recursive: true });
            await fs.mkdir(dir2, { recursive: true });

            const link1 = path.join(dir1, "multi");
            const link2 = path.join(dir2, "multi");
            await fs.symlink(canonicalDir, link1);
            await fs.symlink(canonicalDir, link2);

            const removed = await removeSymlinks([
                { linkPath: link1, targetPath: canonicalDir },
                { linkPath: link2, targetPath: canonicalDir },
            ]);
            expect(removed).toBe(2);
        });
    });
});
