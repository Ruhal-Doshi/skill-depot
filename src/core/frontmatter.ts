import matter from "gray-matter";

export interface SkillFrontmatter {
    name: string;
    description?: string;
    tags?: string[];
    keywords?: string[];
    related?: string[];
    [key: string]: unknown; // Allow extra fields from user-authored frontmatter
}

export interface ParsedSkill {
    frontmatter: SkillFrontmatter;
    body: string;
    raw: string;
}

/**
 * Parse a skill markdown file's content into frontmatter and body
 */
export function parseSkillContent(content: string): ParsedSkill {
    const { data, content: body } = matter(content);

    const frontmatter: SkillFrontmatter = {
        name: typeof data.name === "string" ? data.name : "",
        description: typeof data.description === "string" ? data.description : "",
        tags: Array.isArray(data.tags)
            ? data.tags.filter((t: unknown) => typeof t === "string")
            : [],
        keywords: Array.isArray(data.keywords)
            ? data.keywords.filter((k: unknown) => typeof k === "string")
            : [],
        related: Array.isArray(data.related)
            ? data.related.filter((r: unknown) => typeof r === "string")
            : [],
    };

    return { frontmatter, body: body.trim(), raw: content };
}

/**
 * Serialize frontmatter and body back into a markdown string
 */
export function serializeSkill(
    frontmatter: Partial<SkillFrontmatter> & { name: string },
    body: string
): string {
    // Only include non-empty fields
    const data: Record<string, unknown> = {};
    if (frontmatter.name) data.name = frontmatter.name;
    if (frontmatter.description) data.description = frontmatter.description;
    if (frontmatter.tags && frontmatter.tags.length > 0) data.tags = frontmatter.tags;
    if (frontmatter.keywords && frontmatter.keywords.length > 0) data.keywords = frontmatter.keywords;
    if (frontmatter.related && frontmatter.related.length > 0) data.related = frontmatter.related;

    return matter.stringify(body, data);
}

/**
 * Generate indexable text from frontmatter for embedding
 */
export function generateIndexableText(
    frontmatter: Partial<SkillFrontmatter>,
    body?: string
): string {
    const parts: string[] = [];

    if (frontmatter.name) parts.push(frontmatter.name);
    if (frontmatter.description) parts.push(frontmatter.description);
    if (frontmatter.tags && frontmatter.tags.length > 0) parts.push(frontmatter.tags.join(" "));
    if (frontmatter.keywords && frontmatter.keywords.length > 0)
        parts.push(frontmatter.keywords.join(" "));

    // Extract headings from body for additional context
    if (body) {
        const headings = body
            .split("\n")
            .filter((line) => line.startsWith("#"))
            .map((line) => line.replace(/^#+\s*/, ""))
            .join(" ");
        if (headings) parts.push(headings);
    }

    return parts.join(". ");
}

/**
 * Generate a short snippet from the skill content (for search results)
 */
export function generateSnippet(
    frontmatter: Partial<SkillFrontmatter>,
    body: string,
    maxLength = 200
): string {
    // Prefer the description from frontmatter
    if (frontmatter.description && frontmatter.description.length > 0) {
        return frontmatter.description.length > maxLength
            ? frontmatter.description.slice(0, maxLength - 3) + "..."
            : frontmatter.description;
    }

    // Fall back to first paragraph of body
    const firstParagraph = body.split("\n\n")[0] || body;
    const cleaned = firstParagraph.replace(/^#+\s*/gm, "").trim();
    return cleaned.length > maxLength
        ? cleaned.slice(0, maxLength - 3) + "..."
        : cleaned;
}

/**
 * Generate a structured overview from the skill body.
 * Extracts each markdown heading and the first sentence beneath it.
 * Returns "" if the body contains no headings.
 */
export function generateOverview(body: string): string {
    if (!body) return "";

    const lines = body.split("\n");
    const sections: string[] = [];
    let inCodeBlock = false;
    let currentHeading: string | null = null;
    let foundSentence = false;

    for (const line of lines) {
        // Track fenced code blocks
        if (line.trimStart().startsWith("```") || line.trimStart().startsWith("~~~")) {
            inCodeBlock = !inCodeBlock;
            continue;
        }

        if (inCodeBlock) continue;

        // Check for heading
        if (line.startsWith("#")) {
            // Flush previous heading if we haven't found a sentence for it
            if (currentHeading !== null) {
                sections.push(currentHeading);
            }
            currentHeading = line;
            foundSentence = false;
            continue;
        }

        // Look for first sentence after a heading
        if (currentHeading !== null && !foundSentence) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;

            // Extract first sentence: up to ". " or ".\n" or end of line
            const sentenceEnd = trimmed.search(/\.\s/);
            const sentence = sentenceEnd !== -1
                ? trimmed.slice(0, sentenceEnd + 1)
                : trimmed;

            sections.push(currentHeading + "\n" + sentence);
            currentHeading = null;
            foundSentence = true;
        }
    }

    // Flush last heading if no sentence followed it
    if (currentHeading !== null) {
        sections.push(currentHeading);
    }

    return sections.length > 0 ? sections.join("\n\n") : "";
}
