// Vector checks at the engine boundary (ADR 0132 § 2): a non-finite vector is
// an error, never a return value. NaN or Inf in one vector turns every score
// it touches into NaN and silently corrupts the ordering of a whole index.

/**
 * Throws when `vector` is empty, holds a non-finite value, or is all zeros —
 * a zero vector has no direction, so cosine similarity is undefined for it.
 */
export function checkVector(vector: ArrayLike<number>): void {
    if (vector.length === 0) throw new Error('embedding engine returned an empty vector');
    let norm2 = 0;
    for (let i = 0; i < vector.length; i++) {
        const value = vector[i];
        if (!Number.isFinite(value)) throw new Error('embedding engine returned a non-finite value');
        norm2 += value * value;
    }
    if (norm2 === 0) throw new Error('embedding engine returned a zero-norm vector');
}

/** A unit-length copy. Throws on what {@link checkVector} rejects. */
export function normalize(vector: ArrayLike<number>): Float32Array {
    checkVector(vector);
    let norm2 = 0;
    for (let i = 0; i < vector.length; i++) norm2 += vector[i] * vector[i];
    const norm = Math.sqrt(norm2);
    const out = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
    return out;
}

/**
 * Matryoshka truncation: keep the leading `dimensions` and renormalise. Only
 * meaningful for a model trained for it; the model's entry lists the sizes.
 */
export function truncateVector(vector: ArrayLike<number>, dimensions: number): Float32Array {
    if (vector.length < dimensions) {
        throw new Error(`cannot truncate a ${vector.length}-dimensional vector to ${dimensions}`);
    }
    return normalize(Array.prototype.slice.call(vector, 0, dimensions) as number[]);
}
