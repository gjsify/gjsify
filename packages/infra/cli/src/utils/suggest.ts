// "Did you mean …?" for CLI name typos (unknown workspace, unknown script, …).
// Kept free of platform imports so it is safe to pull into a GJS-bundled command.

/**
 * Levenshtein edit distance. Case-SENSITIVE — callers lower-case first if they
 * want otherwise.
 */
export function editDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    let curr = Array.from({ length: b.length + 1 }, () => 0);
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1, // deletion
                curr[j - 1] + 1, // insertion
                prev[j - 1] + cost, // substitution
            );
        }
        [prev, curr] = [curr, prev];
    }
    return prev[b.length];
}

/**
 * The closest candidate to `target`, or `undefined` when none is close enough.
 * The threshold `max(2, floor(len/3))` scales with target length so a short name
 * does not match everything while a long one still tolerates a couple of typos.
 * Comparison is case-insensitive.
 */
export function suggestClosest(target: string, candidates: readonly string[]): string | undefined {
    if (candidates.length === 0) return undefined;
    const t = target.toLowerCase();
    const threshold = Math.max(2, Math.floor(target.length / 3));

    let best: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const d = editDistance(t, candidate.toLowerCase());
        if (d < bestDistance) {
            bestDistance = d;
            best = candidate;
        }
    }
    return best !== undefined && bestDistance <= threshold ? best : undefined;
}
