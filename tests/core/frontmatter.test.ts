import { describe, it, expect } from "vitest";
import {
    parseSkillContent,
    serializeSkill,
    generateIndexableText,
    generateSnippet,
    generateOverview,
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
                related: [],
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
                related: [],
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
                related: [],
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
                related: [],
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

    describe("generateOverview", () => {
        it("should extract headings and first sentences", () => {
            const body = `## Getting Started

First you need to install the dependencies. Then configure the environment.

## Configuration

Set up your config file in the root directory. Make sure to add API keys.

## Deployment

Run the deploy command to push to production.`;

            const overview = generateOverview(body);

            expect(overview).toContain("## Getting Started");
            expect(overview).toContain("First you need to install the dependencies.");
            expect(overview).toContain("## Configuration");
            expect(overview).toContain("Set up your config file in the root directory.");
            expect(overview).toContain("## Deployment");
            expect(overview).toContain("Run the deploy command to push to production.");
        });

        it("should return empty string when no headings", () => {
            const body = "Just plain text without any headings.\n\nAnother paragraph.";
            expect(generateOverview(body)).toBe("");
        });

        it("should handle consecutive headings with no body text", () => {
            const body = `## First Heading

## Second Heading

Some content here.`;

            const overview = generateOverview(body);

            expect(overview).toContain("## First Heading");
            expect(overview).toContain("## Second Heading");
            expect(overview).toContain("Some content here.");
        });

        it("should skip content inside fenced code blocks", () => {
            const body = `## Setup

Install the package.

\`\`\`bash
npm install skill-depot
\`\`\`

## Usage

Call the function directly.`;

            const overview = generateOverview(body);

            expect(overview).toContain("## Setup");
            expect(overview).toContain("Install the package.");
            expect(overview).toContain("## Usage");
            expect(overview).toContain("Call the function directly.");
            expect(overview).not.toContain("npm install");
        });

        it("should extract only the first sentence from multi-sentence paragraphs", () => {
            const body = `## Overview

This is the first sentence. This is the second sentence. And a third one.`;

            const overview = generateOverview(body);

            expect(overview).toContain("This is the first sentence.");
            expect(overview).not.toContain("second sentence");
        });

        it("should handle heading with only a code block beneath", () => {
            const body = `## Example

\`\`\`typescript
const x = 1;
\`\`\`

## Next Section

Some text here.`;

            const overview = generateOverview(body);

            expect(overview).toContain("## Example");
            expect(overview).toContain("## Next Section");
            expect(overview).toContain("Some text here.");
            expect(overview).not.toContain("const x");
        });

        it("should return empty string for empty body", () => {
            expect(generateOverview("")).toBe("");
        });
    });
});
