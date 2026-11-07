// Spreading texts over several engine contexts. Pure, so the scheduling and
// the failure rule are testable without a model.

export interface PoolResult<T> {
    /** One slot per text; a slot is empty when its text was never embedded. */
    vectors: (T | undefined)[];
    /** The first error a context threw, if any. */
    failure?: { error: unknown };
}

/**
 * Every context takes the next text until none is left, so one long text does
 * not hold up the others. The first failure stops the workers from taking
 * more, and the call returns only once EVERY worker has settled: the caller
 * may then dispose the contexts, which is not safe under a running evaluation.
 */
export async function embedAcross<C, T>(
    contexts: readonly C[],
    texts: readonly string[],
    embedOne: (context: C, text: string) => Promise<T>,
): Promise<PoolResult<T>> {
    const vectors = Array.from<T | undefined>({ length: texts.length });
    let failure: { error: unknown } | undefined;
    let next = 0;
    await Promise.all(
        contexts.map(async (context) => {
            while (failure === undefined && next < texts.length) {
                const index = next++;
                try {
                    vectors[index] = await embedOne(context, texts[index]);
                } catch (error) {
                    failure ??= { error };
                }
            }
        }),
    );
    return failure === undefined ? { vectors } : { vectors, failure };
}
