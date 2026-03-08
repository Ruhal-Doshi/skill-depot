import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
    parseSkillContent,
    serializeSkill,
    type SkillFrontmatter,
    type ParsedSkill,
} from "./frontmatter.js";

/**
 * Read and parse a skill file from disk
 */
export async function readSkillFile(filePath: string): Promise<ParsedSkill> {
    const content = await fs.readFile(filePath, "utf-8");
    return parseSkillContent(content);
}

/**
 * Write a skill file to disk with frontmatter
 */
export async function writeSkillFile(
    filePath: string,
    frontmatter: SkillFrontmatter,
    body: string
): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const content = serializeSkill(frontmatter, body);
    await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Delete a skill file from disk
 */
export async function deleteSkillFile(filePath: string): Promise<boolean> {
    try {
        await fs.unlink(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Generate a SHA-256 hash of file content for staleness detection
 */
export function hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

/**
 * Check if a file exists
 */
export function fileExists(filePath: string): boolean {
    return existsSync(filePath);
}

/**
 * Copy a skill file from source to destination
 */
export async function copySkillFile(
    srcPath: string,
    destPath: string
): Promise<void> {
    const destDir = path.dirname(destPath);
    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(srcPath, destPath);
}

/**
 * List all .md files in a directory (recursive)
 */
export async function listSkillFiles(dirPath: string): Promise<string[]> {
    if (!existsSync(dirPath)) return [];

    const results: string[] = [];
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile() && entry.name.endsWith(".md")) {
            results.push(fullPath);
        } else if (entry.isDirectory()) {
            const nested = await listSkillFiles(fullPath);
            results.push(...nested);
        }
    }

    return results;
}

/**
 * Get the skill name from a file path (filename without .md extension)
 */
export function getSkillNameFromPath(filePath: string): string {
    return path.basename(filePath, ".md");
}
