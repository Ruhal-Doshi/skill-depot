import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, lstatSync, readlinkSync, readdirSync } from "node:fs";

/**
 * Agent directories where skills.sh creates symlinks.
 * Each points into ~/.agents/skills/<name> as the canonical source.
 */
function getAgentSymlinkDirs(): string[] {
    const home = os.homedir();
    return [
        path.join(home, ".cursor", "skills"),
        path.join(home, ".cursor", "skills-cursor"),
        path.join(home, ".claude", "skills"),
        path.join(home, ".codex", "skills"),
        path.join(home, ".gemini", "skills"),
        path.join(home, ".openclaw", "skills"),
        path.join(home, ".open-claw", "skills"),
        path.join(home, ".windsurf", "skills"),
        path.join(home, ".codeium", "windsurf", "skills"),
        path.join(home, ".copilot", "skills"),
    ];
}

export interface CleanedSymlink {
    linkPath: string;
    targetPath: string;
}

/**
 * Find symlinks in known agent directories that point to the
 * skills.sh canonical store (~/.agents/skills/).
 */
export function findAgentSymlinks(): CleanedSymlink[] {
    const home = os.homedir();
    const canonicalBase = path.join(home, ".agents", "skills");
    const found: CleanedSymlink[] = [];

    for (const dir of getAgentSymlinkDirs()) {
        if (!existsSync(dir)) continue;

        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                try {
                    const stat = lstatSync(fullPath);
                    if (!stat.isSymbolicLink()) continue;

                    const target = readlinkSync(fullPath);
                    const resolved = path.resolve(path.dirname(fullPath), target);
                    if (resolved.startsWith(canonicalBase + path.sep) || resolved === canonicalBase) {
                        found.push({ linkPath: fullPath, targetPath: resolved });
                    }
                } catch {
                    // unreadable symlink
                }
            }
        } catch {
            // directory unreadable
        }
    }

    return found;
}

/**
 * Remove a list of symlinks from agent directories.
 * Returns the count of successfully removed links.
 */
export async function removeSymlinks(links: CleanedSymlink[]): Promise<number> {
    let removed = 0;
    for (const { linkPath } of links) {
        try {
            await fs.unlink(linkPath);
            removed++;
        } catch {
            // already gone or permission denied
        }
    }
    return removed;
}
