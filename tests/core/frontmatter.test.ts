import { describe, it, expect } from "vitest";
import {
    parseSkillContent,
    serializeSkill,
    generateIndexableText,
    generateSnippet,
    type SkillFrontmatter,
} from "../../src/core/frontmatter.js";

describe("frontmatter", () => {
    describe("parseSkillContent", () => {
        it("should parse a full skill file with all frontmatter fields", () => {
            const content = `---
name: deploy-vercel
description: Deploy a Next.js app to Vercel
tags:
  - deployment
  - vercel
keywords:
  - vercel cli
  - production
---

## Steps

1. Install Vercel CLI
2. Run \`vercel\``;

            const result = parseSkillContent(content);

            expect(result.frontmatter.name).toBe("deploy-vercel");
            expect(result.frontmatter.description).toBe("Deploy a Next.js app to Vercel");
            expect(result.frontmatter.tags).toEqual(["deployment", "vercel"]);
            expect(result.frontmatter.keywords).toEqual(["vercel cli", "production"]);
            expect(result.body).toContain("## Steps");
            expect(result.raw).toBe(content);
        });

        it("should handle missing frontmatter fields with defaults", () => {
            const content = `---
name: minimal-skill
---

Some content here.`;

            const result = parseSkillContent(content);

            expect(result.frontmatter.name).toBe("minimal-skill");
            expect(result.frontmatter.description).toBe("");
            expect(result.frontmatter.tags).toEqual([]);
            expect(result.frontmatter.keywords).toEqual([]);
        });

        it("should handle no frontmatter at all", () => {
            const content = "Just plain markdown content.";

            const result = parseSkillContent(content);

            expect(result.frontmatter.name).toBe("");
            expect(result.frontmatter.description).toBe("");
            expect(result.frontmatter.tags).toEqual([]);
            expect(result.frontmatter.keywords).toEqual([]);
            expect(result.body).toBe("Just plain markdown content.");
        });

        it("should filter out non-string values from tags and keywords", () => {
            const content = `---
name: test
tags:
  - valid
  - 123
keywords:
  - good
  - true
---

Body.`;

            const result = parseSkillContent(content);

            // Only string values should be kept
            expect(result.frontmatter.tags).toEqual(["valid"]);
            expect(result.frontmatter.keywords).toEqual(["good"]);
        });
    });

    describe("serializeSkill", () => {
        it("should round-trip serialize and parse", () => {
            const frontmatter: SkillFrontmatter = {
                name: "test-skill",
                description: "A test skill",
                tags: ["testing"],
                keywords: ["unit test"],
            };
            const body = "## Instructions\n\n1. Do the thing";

            const serialized = serializeSkill(frontmatter, body);
            const parsed = parseSkillContent(serialized);

            expect(parsed.frontmatter.name).toBe("test-skill");
            expect(parsed.frontmatter.description).toBe("A test skill");
            expect(parsed.frontmatter.tags).toEqual(["testing"]);
            expect(parsed.frontmatter.keywords).toEqual(["unit test"]);
            expect(parsed.body).toContain("## Instructions");
        });

        it("should omit empty fields", () => {
            const frontmatter: SkillFrontmatter = {
                name: "minimal",
                description: "",
                tags: [],
                keywords: [],
            };

            const serialized = serializeSkill(frontmatter, "Body");

            expect(serialized).not.toContain("description");
            expect(serialized).not.toContain("tags");
            expect(serialized).not.toContain("keywords");
            expect(serialized).toContain("name: minimal");
        });
    });

    describe("generateIndexableText", () => {
        it("should combine all frontmatter fields", () => {
            const frontmatter: SkillFrontmatter = {
                name: "deploy",
                description: "Deploy to production",
                tags: ["ci", "cd"],
                keywords: ["github actions"],
            };

            const text = generateIndexableText(frontmatter);

            expect(text).toContain("deploy");
            expect(text).toContain("Deploy to production");
            expect(text).toContain("ci");
            expect(text).toContain("cd");
            expect(text).toContain("github actions");
        });

        it("should extract headings from body", () => {
            const frontmatter: SkillFrontmatter = {
                name: "test",
                description: "",
                tags: [],
                keywords: [],
            };
            const body = "# Main Title\n\nSome text\n\n## Sub Section\n\nMore text";

            const text = generateIndexableText(frontmatter, body);

            expect(text).toContain("Main Title");
            expect(text).toContain("Sub Section");
        });

        it("should handle empty frontmatter", () => {
            const frontmatter: SkillFrontmatter = {
                name: "",
                description: "",
                tags: [],
                keywords: [],
            };

            const text = generateIndexableText(frontmatter);

            expect(text).toBe("");
        });
    });

    describe("generateSnippet", () => {
        it("should prefer description from frontmatter", () => {
            const frontmatter: SkillFrontmatter = {
                name: "test",
                description: "This is the description",
                tags: [],
                keywords: [],
            };

            const snippet = generateSnippet(frontmatter, "## Body content\n\nLots of text here.");

            expect(snippet).toBe("This is the description");
        });

        it("should fall back to first paragraph of body", () => {
            const frontmatter: SkillFrontmatter = {
                name: "test",
                description: "",
                tags: [],
                keywords: [],
            };

            const snippet = generateSnippet(frontmatter, "First paragraph here.\n\nSecond paragraph.");

            expect(snippet).toBe("First paragraph here.");
        });

        it("should truncate long descriptions", () => {
            const longDesc = "A".repeat(300);
            const frontmatter: SkillFrontmatter = {
                name: "test",
                description: longDesc,
                tags: [],
                keywords: [],
            };

            const snippet = generateSnippet(frontmatter, "", 200);

            expect(snippet.length).toBe(200);
            expect(snippet.endsWith("...")).toBe(true);
        });
    });
});
