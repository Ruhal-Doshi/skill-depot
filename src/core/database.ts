import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export interface SkillRecord {
    id: number;
    name: string;
    description: string;
    tags: string; // JSON array
    keywords: string; // JSON array
    content_hash: string;
    file_path: string;
    scope: "global" | "project";
    snippet: string;
    indexable_text: string;
    created_at: string;
    updated_at: string;
}

export interface SkillInsert {
    name: string;
    description: string;
    tags: string[];
    keywords: string[];
    contentHash: string;
    filePath: string;
    scope: "global" | "project";
    snippet: string;
    indexableText: string;
    embedding: Float32Array;
}

export interface VectorSearchResult {
    skillId: number;
    distance: number;
}

const EMBEDDING_DIMENSIONS = 384; // all-MiniLM-L6-v2

/**
 * Initialize the database with schema and sqlite-vec extension
 */
export function createDatabase(dbPath: string): Database.Database {
    const db = new Database(dbPath);

    // Enable WAL mode for better concurrent read performance
    db.pragma("journal_mode = WAL");

    // Load sqlite-vec extension
    sqliteVec.load(db);

    // Create schema
    db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      keywords TEXT NOT NULL DEFAULT '[]',
      content_hash TEXT NOT NULL,
      file_path TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('global', 'project')),
      snippet TEXT NOT NULL DEFAULT '',
      indexable_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS skill_vectors USING vec0 (
      skill_id INTEGER PRIMARY KEY,
      embedding FLOAT[${EMBEDDING_DIMENSIONS}]
    );

    CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
    CREATE INDEX IF NOT EXISTS idx_skills_scope ON skills(scope);
  `);

    return db;
}

/**
 * Insert a new skill and its embedding vector
 */
export function insertSkill(db: Database.Database, skill: SkillInsert): number {
    const now = new Date().toISOString();

    const insertSkillStmt = db.prepare(`
    INSERT INTO skills (name, description, tags, keywords, content_hash, file_path, scope, snippet, indexable_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

    const transaction = db.transaction(() => {
        const result = insertSkillStmt.run(
            skill.name,
            skill.description,
            JSON.stringify(skill.tags),
            JSON.stringify(skill.keywords),
            skill.contentHash,
            skill.filePath,
            skill.scope,
            skill.snippet,
            skill.indexableText,
            now,
            now
        );

        const skillId = Number(result.lastInsertRowid);

        // Convert Float32Array to a Buffer for sqlite-vec
        const embeddingBuffer = Buffer.from(
            skill.embedding.buffer,
            skill.embedding.byteOffset,
            skill.embedding.byteLength
        );

        // NOTE: sqlite-vec vec0 virtual tables reject bound parameters for
        // integer primary keys. We must interpolate skill_id as a SQL literal.
        db.prepare(
            `INSERT INTO skill_vectors (skill_id, embedding) VALUES (${skillId}, ?)`
        ).run(embeddingBuffer);

        return skillId;
    });

    return transaction();
}

/**
 * Update an existing skill and its embedding
 */
export function updateSkill(
    db: Database.Database,
    name: string,
    updates: Partial<SkillInsert>
): boolean {
    const existing = getSkillByName(db, name);
    if (!existing) return false;

    const now = new Date().toISOString();

    const updateStmt = db.prepare(`
    UPDATE skills SET
      description = COALESCE(?, description),
      tags = COALESCE(?, tags),
      keywords = COALESCE(?, keywords),
      content_hash = COALESCE(?, content_hash),
      file_path = COALESCE(?, file_path),
      snippet = COALESCE(?, snippet),
      indexable_text = COALESCE(?, indexable_text),
      updated_at = ?
    WHERE name = ?
  `);

    const transaction = db.transaction(() => {
        updateStmt.run(
            updates.description ?? null,
            updates.tags ? JSON.stringify(updates.tags) : null,
            updates.keywords ? JSON.stringify(updates.keywords) : null,
            updates.contentHash ?? null,
            updates.filePath ?? null,
            updates.snippet ?? null,
            updates.indexableText ?? null,
            now,
            name
        );

        // Update vector if new embedding provided
        if (updates.embedding) {
            // NOTE: vec0 primary keys must be SQL literals, not bound params
            db.prepare(
                `DELETE FROM skill_vectors WHERE skill_id = ${existing.id}`
            ).run();
            const embeddingBuffer = Buffer.from(
                updates.embedding.buffer,
                updates.embedding.byteOffset,
                updates.embedding.byteLength
            );
            db.prepare(
                `INSERT INTO skill_vectors (skill_id, embedding) VALUES (${existing.id}, ?)`
            ).run(embeddingBuffer);
        }
    });

    transaction();
    return true;
}

/**
 * Delete a skill by name
 */
export function deleteSkill(db: Database.Database, name: string): boolean {
    const existing = getSkillByName(db, name);
    if (!existing) return false;

    const transaction = db.transaction(() => {
        // NOTE: vec0 primary keys must be SQL literals, not bound params
        db.prepare(`DELETE FROM skill_vectors WHERE skill_id = ${existing.id}`).run();
        db.prepare(`DELETE FROM skills WHERE id = ?`).run(existing.id);
    });

    transaction();
    return true;
}

/**
 * Get a skill by its name
 */
export function getSkillByName(
    db: Database.Database,
    name: string
): SkillRecord | undefined {
    return db
        .prepare(`SELECT * FROM skills WHERE name = ?`)
        .get(name) as SkillRecord | undefined;
}

/**
 * Get all skills, optionally filtered by scope and/or tag
 */
export function getAllSkills(
    db: Database.Database,
    scope?: "global" | "project",
    tag?: string
): SkillRecord[] {
    let query = `SELECT * FROM skills WHERE 1=1`;
    const params: unknown[] = [];

    if (scope) {
        query += ` AND scope = ?`;
        params.push(scope);
    }

    if (tag) {
        query += ` AND tags LIKE ?`;
        params.push(`%"${tag}"%`);
    }

    query += ` ORDER BY name ASC`;

    return db.prepare(query).all(...params) as SkillRecord[];
}

/**
 * Perform KNN vector search
 */
export function searchByVector(
    db: Database.Database,
    queryEmbedding: Float32Array,
    topK: number = 5
): VectorSearchResult[] {
    const embeddingBuffer = Buffer.from(
        queryEmbedding.buffer,
        queryEmbedding.byteOffset,
        queryEmbedding.byteLength
    );

    const results = db
        .prepare(
            `
    SELECT skill_id, distance
    FROM skill_vectors
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `
        )
        .all(embeddingBuffer, topK) as Array<{
            skill_id: number;
            distance: number;
        }>;

    return results.map((r) => ({
        skillId: r.skill_id,
        distance: r.distance,
    }));
}

/**
 * Get a skill by ID
 */
export function getSkillById(
    db: Database.Database,
    id: number
): SkillRecord | undefined {
    return db
        .prepare(`SELECT * FROM skills WHERE id = ?`)
        .get(id) as SkillRecord | undefined;
}

/**
 * Drop all vector data and skill records (for reindex)
 */
export function clearAllSkills(db: Database.Database): void {
    db.exec(`
    DELETE FROM skill_vectors;
    DELETE FROM skills;
  `);
}

/**
 * Get total number of indexed skills
 */
export function getSkillCount(db: Database.Database): number {
    const result = db
        .prepare(`SELECT COUNT(*) as count FROM skills`)
        .get() as { count: number };
    return result.count;
}
