import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { detectAgents, summarizeDiscovery } from "../../src/discovery/detector.js";

describe("detector", () => {
    let tmpDir: string;
    let originalHomedir: typeof os.homedir;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-depot-detector-"));
        originalHomedir = os.homedir;
        vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    describe("skills.sh canonical store", () => {
        it("should discover skills in ~/.agents/skills/<name>/SKILL.md", async () => {
            const agentsSkills = path.join(tmpDir, ".agents", "skills");
            await fs.mkdir(path.join(agentsSkills, "deploy-vercel"), { recursive: true });
            await fs.mkdir(path.join(agentsSkills, "setup-eslint"), { recursive: true });
            await fs.writeFile(
                path.join(agentsSkills, "deploy-vercel", "SKILL.md"),
                "---\nname: deploy-vercel\ndescription: Deploy to Vercel\n---\n# Deploy"
            );
            await fs.writeFile(
                path.join(agentsSkills, "setup-eslint", "SKILL.md"),
                "---\nname: setup-eslint\ndescription: Set up ESLint\n---\n# ESLint"
            );

            const results = await detectAgents();

            const skillsSh = results.filter((r) => r.agent === "skills.sh");
            expect(skillsSh).toHaveLength(1);
            expect(skillsSh[0].scope).toBe("global");
            expect(skillsSh[0].files).toHaveLength(2);
            expect(skillsSh[0].files.map((f) => path.basename(f))).toEqual([
                "SKILL.md",
                "SKILL.md",
            ]);
            // Verify the parent directory names
            expect(skillsSh[0].files.map((f) => path.basename(path.dirname(f))).sort()).toEqual([
                "deploy-vercel",
                "setup-eslint",
            ]);
        });

        it("should skip directories without SKILL.md", async () => {
            const agentsSkills = path.join(tmpDir, ".agents", "skills");
            await fs.mkdir(path.join(agentsSkills, "valid-skill"), { recursive: true });
            await fs.mkdir(path.join(agentsSkills, "no-skill-md"), { recursive: true });
            await fs.writeFile(
                path.join(agentsSkills, "valid-skill", "SKILL.md"),
                "---\nname: valid\ndescription: Valid\n---\n# Valid"
            );
            await fs.writeFile(
                path.join(agentsSkills, "no-skill-md", "README.md"),
                "Not a skill"
            );

            const results = await detectAgents();
            const skillsSh = results.filter((r) => r.agent === "skills.sh");
            expect(skillsSh).toHaveLength(1);
            expect(skillsSh[0].files).toHaveLength(1);
        });

        it("should return empty when ~/.agents/skills/ does not exist", async () => {
            const results = await detectAgents();
            const skillsSh = results.filter((r) => r.agent === "skills.sh");
            expect(skillsSh).toHaveLength(0);
        });

        it("should discover project-level skills.sh skills", async () => {
            const projectRoot = path.join(tmpDir, "my-project");
            const projectAgentsSkills = path.join(projectRoot, ".agents", "skills");
            await fs.mkdir(path.join(projectAgentsSkills, "local-skill"), { recursive: true });
            await fs.writeFile(
                path.join(projectAgentsSkills, "local-skill", "SKILL.md"),
                "---\nname: local-skill\ndescription: Local\n---\n# Local"
            );

            const results = await detectAgents(projectRoot);
            const projectSkillsSh = results.filter(
                (r) => r.agent === "skills.sh" && r.scope === "project"
            );
            expect(projectSkillsSh).toHaveLength(1);
            expect(projectSkillsSh[0].files).toHaveLength(1);
        });
    });

    describe("summarizeDiscovery", () => {
        it("should count skills correctly across scopes", () => {
            const summary = summarizeDiscovery([
                { agent: "skills.sh", scope: "global", directory: "/a", files: ["/a/1", "/a/2"] },
                { agent: "Claude Code", scope: "project", directory: "/b", files: ["/b/1"] },
            ]);

            expect(summary.totalSkills).toBe(3);
            expect(summary.globalSkills).toBe(2);
            expect(summary.projectSkills).toBe(1);
            expect(summary.agents.sort()).toEqual(["Claude Code", "skills.sh"]);
        });

        it("should handle empty discovery", () => {
            const summary = summarizeDiscovery([]);
            expect(summary.totalSkills).toBe(0);
            expect(summary.agents).toEqual([]);
        });
    });
});
