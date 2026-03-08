import path from "node:path";
import { existsSync } from "node:fs";
import { getGlobalPaths } from "./storage.js";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIMENSIONS = 384;

// Lazy-loaded transformer pipeline
let pipeline: any = null;
let pipelinePromise: Promise<any> | null = null;

/**
 * Initialize the embedding pipeline (downloads model on first use)
 */
async function getEmbeddingPipeline(
    onProgress?: (progress: { status: string; progress?: number }) => void
): Promise<any> {
    if (pipeline) return pipeline;

    if (pipelinePromise) return pipelinePromise;

    pipelinePromise = (async () => {
        const { pipeline: createPipeline, env } = await import(
            "@xenova/transformers"
        );

        // Store models in the global skill-depot directory
        const modelsDir = getGlobalPaths().modelsDir;
        env.cacheDir = modelsDir;
        env.localModelPath = modelsDir;

        // Disable remote model loading if we already have it cached
        const modelLocalPath = path.join(modelsDir, MODEL_NAME.replace("/", "--"));
        if (existsSync(modelLocalPath)) {
            env.allowRemoteModels = true; // still allow but will use cache
        }

        try {
            pipeline = await createPipeline("feature-extraction", MODEL_NAME, {
                progress_callback: onProgress,
            });
            return pipeline;
        } catch (error) {
            pipelinePromise = null;
            throw error;
        }
    })();

    return pipelinePromise;
}

/**
 * Generate embeddings using the transformer model
 */
export async function generateEmbedding(
    text: string,
    onProgress?: (progress: { status: string; progress?: number }) => void
): Promise<Float32Array> {
    try {
        const pipe = await getEmbeddingPipeline(onProgress);
        const result = await pipe(text, {
            pooling: "mean",
            normalize: true,
        });
        return new Float32Array(result.data);
    } catch (error) {
        // Fall back to BM25-style embedding
        console.warn(
            "Transformer embedding failed, using BM25 fallback:",
            (error as Error).message
        );
        return generateBM25Embedding(text);
    }
}

/**
 * Generate embeddings for multiple texts (batch)
 */
export async function generateEmbeddings(
    texts: string[],
    onProgress?: (progress: { status: string; progress?: number }) => void
): Promise<Float32Array[]> {
    // Process one at a time to avoid memory issues
    const results: Float32Array[] = [];
    for (const text of texts) {
        results.push(await generateEmbedding(text, onProgress));
    }
    return results;
}

/**
 * BM25-style fallback embedding using term frequency hashing.
 * Maps terms to fixed positions in the embedding vector using a hash.
 */
export function generateBM25Embedding(text: string): Float32Array {
    const embedding = new Float32Array(EMBEDDING_DIMENSIONS);

    // Simple tokenization
    const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1);

    if (tokens.length === 0) return embedding;

    // Count term frequencies
    const termFreqs = new Map<string, number>();
    for (const token of tokens) {
        termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
    }

    // Hash each term to a position in the embedding vector
    for (const [term, freq] of termFreqs) {
        const hash = simpleHash(term);
        const position = Math.abs(hash) % EMBEDDING_DIMENSIONS;
        const sign = hash > 0 ? 1 : -1;
        // Use log TF to dampen high-frequency terms
        embedding[position] += sign * (1 + Math.log(freq));
    }

    // L2 normalize the vector
    let norm = 0;
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
        norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
            embedding[i] /= norm;
        }
    }

    return embedding;
}

/**
 * Simple string hash function (DJB2)
 */
function simpleHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash;
}

/**
 * Check if the transformer model is already downloaded
 */
export function isModelDownloaded(): boolean {
    const modelsDir = getGlobalPaths().modelsDir;
    const modelPath = path.join(modelsDir, MODEL_NAME.replace("/", "--"));
    return existsSync(modelPath);
}

/**
 * Get the expected embedding dimensions
 */
export function getEmbeddingDimensions(): number {
    return EMBEDDING_DIMENSIONS;
}
