import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find package.json by looking up the directory tree
function getVersion(): string {
    let currentDir = __dirname;
    while (currentDir !== "/" && currentDir !== path.parse(currentDir).root) {
        const pkgPath = path.join(currentDir, "package.json");
        if (fs.existsSync(pkgPath)) {
            const content = fs.readFileSync(pkgPath, "utf-8");
            try {
                const pkg = JSON.parse(content);
                return pkg.version || "0.0.1-alpha.0";
            } catch {
                return "0.0.1-alpha.0";
            }
        }
        currentDir = path.dirname(currentDir);
    }
    return "0.0.1-alpha.0";
}

export const VERSION = getVersion();
