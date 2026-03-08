// skill-depot — Public API
// Re-export core modules for programmatic usage

export { createSkillDepotServer } from "./mcp/server.js";
export { createDatabase, insertSkill, updateSkill, deleteSkill, getSkillByName, searchByVector, getAllSkills } from "./core/database.js";
export { generateEmbedding, generateBM25Embedding, isModelDownloaded } from "./core/embeddings.js";
export { searchSkills, listSkills } from "./core/search.js";
export { readSkillFile, writeSkillFile, deleteSkillFile, listSkillFiles, hashContent } from "./core/file-manager.js";
export { parseSkillContent, serializeSkill, generateIndexableText, generateSnippet } from "./core/frontmatter.js";
export { getGlobalDir, getGlobalPaths, getProjectPaths, ensureGlobalDirs, ensureProjectDirs, getSkillFilePath } from "./core/storage.js";
export { detectAgents, summarizeDiscovery } from "./discovery/detector.js";

export type { SkillRecord, SkillInsert, VectorSearchResult } from "./core/database.js";
export type { ParsedSkill, SkillFrontmatter } from "./core/frontmatter.js";
export type { SearchResult } from "./core/search.js";
export type { StoragePaths, ProjectPaths } from "./core/storage.js";
export type { DiscoveredAgent, DiscoveredSkills } from "./discovery/detector.js";
