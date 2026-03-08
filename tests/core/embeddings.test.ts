import { describe, it, expect } from "vitest";
import {
    generateBM25Embedding,
    getEmbeddingDimensions,
} from "../../src/core/embeddings.js";

describe("embeddings", () => {
    describe("getEmbeddingDimensions", () => {
        it("should return 384 (all-MiniLM-L6-v2 output size)", () => {
            expect(getEmbeddingDimensions()).toBe(384);
        });
    });

    describe("generateBM25Embedding", () => {
        it("should return a Float32Array of correct dimensions", () => {
            const embedding = generateBM25Embedding("hello world");
            expect(embedding).toBeInstanceOf(Float32Array);
            expect(embedding.length).toBe(384);
        });

        it("should return L2-normalized vectors (unit length)", () => {
            const embedding = generateBM25Embedding("deploy nextjs to vercel production");

            let norm = 0;
            for (let i = 0; i < embedding.length; i++) {
                norm += embedding[i] * embedding[i];
            }
            norm = Math.sqrt(norm);

            expect(norm).toBeCloseTo(1.0, 4);
        });

        it("should return zero vector for empty input", () => {
            const embedding = generateBM25Embedding("");
            const sum = embedding.reduce((a, b) => a + Math.abs(b), 0);
            expect(sum).toBe(0);
        });

        it("should return zero vector for single-char tokens", () => {
            const embedding = generateBM25Embedding("a b c d");
            const sum = embedding.reduce((a, b) => a + Math.abs(b), 0);
            expect(sum).toBe(0);
        });

        it("should produce similar embeddings for similar text", () => {
            const emb1 = generateBM25Embedding("deploy nextjs to vercel");
            const emb2 = generateBM25Embedding("deploying nextjs on vercel");

            // Cosine similarity (both are L2-normalized, so dot product = cosine)
            let dot = 0;
            for (let i = 0; i < 384; i++) {
                dot += emb1[i] * emb2[i];
            }

            // Should have some positive similarity
            expect(dot).toBeGreaterThan(0);
        });

        it("should produce different embeddings for different text", () => {
            const emb1 = generateBM25Embedding("deploy nextjs to vercel");
            const emb2 = generateBM25Embedding("configure postgres database");

            // Cosine similarity
            let dot = 0;
            for (let i = 0; i < 384; i++) {
                dot += emb1[i] * emb2[i];
            }

            // Should have lower similarity than similar texts
            // (can't guarantee exact value, but should be low for unrelated texts)
            expect(Math.abs(dot)).toBeLessThan(0.5);
        });

        it("should be deterministic (same input → same output)", () => {
            const emb1 = generateBM25Embedding("deterministic test");
            const emb2 = generateBM25Embedding("deterministic test");

            for (let i = 0; i < 384; i++) {
                expect(emb1[i]).toBe(emb2[i]);
            }
        });
    });
});
