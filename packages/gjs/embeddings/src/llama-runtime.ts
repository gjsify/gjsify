// The one runtime branch the llama.cpp engine cannot avoid: the same native
// addon is reached through `@gjsify/napi` on GJS and through `getLlama()` on Node.

/** What {@link runningOnGjs} looks at; injected so the Node-with-node-gi case is testable. */
export interface RuntimeHost {
    imports?: unknown;
    process?: { versions?: { gjs?: string } };
}

/**
 * Is this GJS? Not "is there an `imports`": node-gi defines
 * `globalThis.imports` on Node too, and asking only that sent a Node app down
 * the `@gjsify/napi` route, which Node cannot load.
 */
export function runningOnGjs(host: RuntimeHost = globalThis as RuntimeHost): boolean {
    return host.imports !== undefined && host.process?.versions?.gjs !== undefined;
}

/**
 * Run SpiderMonkey's garbage collector now; a no-op on Node.
 *
 * GJS decides when to collect from the JS heap alone, and an embedding run's
 * garbage is mostly NATIVE memory behind small wrapper objects. The heap looks
 * small, so no collection comes: a 1500-document run climbed from 0.85 GB to
 * 1.8 GB, and one collection per batch held it at 0.85 GB.
 *
 * A collection inside a database transaction has broken commits before. A
 * caller that embeds inside one sets `collectGarbage: false` on the engine and
 * calls this after the commit.
 */
export function collectGarbage(): void {
    const system = (globalThis as { imports?: { system?: { gc?: () => void } } }).imports?.system;
    system?.gc?.();
}
