// MutationObserver stub for GJS.
// Reference: refs/happy-dom/packages/happy-dom/src/mutation-observer/MutationObserver.ts
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Stub implementation — no actual mutation tracking

import type { Node } from './node.js';

interface MutationObserverOptions {
    childList?: boolean;
    attributes?: boolean;
    characterData?: boolean;
    subtree?: boolean;
    attributeOldValue?: boolean;
    characterDataOldValue?: boolean;
    attributeFilter?: string[];
}

/**
 * Observes nothing — there is no layout engine to observe. It exists because many libraries check
 * for `MutationObserver` and crash without it.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
 */
export class MutationObserver {
    constructor(_callback: (...args: unknown[]) => void) {}

    observe(_target: Node, _options?: MutationObserverOptions): void {}

    disconnect(): void {}

    takeRecords(): unknown[] {
        return [];
    }
}
