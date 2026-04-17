import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import {
    getCanonicalSkillsDir,
    listCanonicalSkills,
    indexSkillMd,
} from "../../src/commands/skills.js";
import { createDatabase, getSkillByName } from "../../src/core/database.js";

describe("skills command helpers", () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-depot-skills-cmd-"));
        vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe("getCanonicalSkillsDir", () => {
        it("should return ~/.agents/skills/", () => {
            const dir = getCanonicalSkillsDir();
            expect(dir).toBe(path.join(tmpDir, ".agents", "skills"));
        });
    });

    describe("listCanonicalSkills", () => {
        it("should list skills with SKILL.md in subdirectories", async () => {
            const skillsDir = path.join(tmpDir, ".agents", "skills");
            await fs.mkdir(path.join(skillsDir, "skill-a"), { recursive: true });
            await fs.mkdir(path.join(skillsDir, "skill-b"), { recursive: true });
            await fs.writeFile(
                path.join(skillsDir, "skill-a", "SKILL.md"),
                "---\nname: skill-a\ndescription: Skill A\n---\n# A"
            );
            await fs.writeFile(
                path.join(skillsDir, "skill-b", "SKILL.md"),
                "---\nname: skill-b\ndescription: Skill B\n---\n# B"
            );

            const skills = listCanonicalSkills();
            expect(skills).toHaveLength(2);
            expect(skills.map((s) => s.name).sort()).toEqual(["skill-a", "skill-b"]);
            expect(skills.every((s) => s.skillMdPath.endsWith("SKILL.md"))).toBe(true);
        });

        it("should skip subdirectories without SKILL.md", async () => {
            const skillsDir = path.join(tmpDir, ".agents", "skills");
            await fs.mkdir(path.join(skillsDir, "valid"), { recursive: true });
            await fs.mkdir(path.join(skillsDir, "invalid"), { recursive: true });
            await fs.writeFile(
                path.join(skillsDir, "valid", "SKILL.md"),
                "---\nname: valid\ndescription: Valid\n---\n# Valid"
            );
            await fs.writeFile(
                path.join(skillsDir, "invalid", "README.md"),
                "Not a skill"
            );

            const skills = listCanonicalSkills();
            expect(skills).toHaveLength(1);
            expect(skills[0].name).toBe("valid");
        });

        it("should skip files (not directories) at the top level", async () => {
            const skillsDir = path.join(tmpDir, ".agents", "skills");
            await fs.mkdir(skillsDir, { recursive: true });
            await fs.writeFile(
                path.join(skillsDir, "stray-file.md"),
                "not a skill dir"
            );

            const skills = listCanonicalSkills();
            expect(skills).toHaveLength(0);
        });

        it("should return empty when directory does not exist", () => {
            const skills = listCanonicalSkills();
            expect(skills).toEqual([]);
        });
    });

    describe("indexSkillMd", () => {
        it("should index a SKILL.md into the database", async () => {
            const dbPath = path.join(tmpDir, "test.db");
            const db = createDatabase(dbPath);

            const skillDir = path.join(tmpDir, "skill-dir");
            await fs.mkdir(skillDir, { recursive: true });
            const skillMdPath = path.join(skillDir, "SKILL.md");
            await fs.writeFile(
                skillMdPath,
                "---\nname: test-skill\ndescription: A test skill\ntags:\n  - testing\n---\n# Test\n\nDo the thing."
            );

            const wasIndexed = await indexSkillMd(db, skillMdPath, "test-skill");
            expect(wasIndexed).toBe(true);

            const record = getSkillByName(db, "test-skill");
            expect(record).toBeDefined();
            expect(record!.name).toBe("test-skill");
            expect(record!.description).toBe("A test skill");
            expect(record!.scope).toBe("global");
            expect(record!.file_path).toBe(skillMdPath);

            db.close();
        });

        it("should skip if already indexed with same content hash", async () => {
            const dbPath = path.join(tmpDir, "test.db");
            const db = createDatabase(dbPath);

            const skillDir = path.join(tmpDir, "skill-dir");
            await fs.mkdir(skillDir, { recursive: true });
            const skillMdPath = path.join(skillDir, "SKILL.md");
            await fs.writeFile(
                skillMdPath,
                "---\nname: same-skill\ndescription: Same\n---\n# Same"
            );

            const first = await indexSkillMd(db, skillMdPath, "same-skill");
            expect(first).toBe(true);

            const second = await indexSkillMd(db, skillMdPath, "same-skill");
            expect(second).toBe(false);

            db.close();
        });

        it("should re-index if content has changed", async () => {
            const dbPath = path.join(tmpDir, "test.db");
            const db = createDatabase(dbPath);

            const skillDir = path.join(tmpDir, "skill-dir");
            await fs.mkdir(skillDir, { recursive: true });
            const skillMdPath = path.join(skillDir, "SKILL.md");
            await fs.writeFile(
                skillMdPath,
                "---\nname: changing-skill\ndescription: Version 1\n---\n# V1"
            );

            const first = await indexSkillMd(db, skillMdPath, "changing-skill");
            expect(first).toBe(true);

            // Modify the file
            await fs.writeFile(
                skillMdPath,
                "---\nname: changing-skill\ndescription: Version 2\n---\n# V2 with more content"
            );

            const second = await indexSkillMd(db, skillMdPath, "changing-skill");
            expect(second).toBe(true);

            const record = getSkillByName(db, "changing-skill");
            expect(record!.description).toBe("Version 2");

            db.close();
        });

        it("should use directory name when frontmatter has no name", async () => {
            const dbPath = path.join(tmpDir, "test.db");
            const db = createDatabase(dbPath);

            const skillDir = path.join(tmpDir, "my-skill-dir");
            await fs.mkdir(skillDir, { recursive: true });
            const skillMdPath = path.join(skillDir, "SKILL.md");
            await fs.writeFile(
                skillMdPath,
                "---\ndescription: No name field\n---\n# Skill without name"
            );

            await indexSkillMd(db, skillMdPath, "my-skill-dir");

            const record = getSkillByName(db, "my-skill-dir");
            expect(record).toBeDefined();
            expect(record!.name).toBe("my-skill-dir");

            db.close();
        });
    });
});
