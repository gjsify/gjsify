// MutationObserver stub for GJS — original implementation
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
 * MutationObserver stub.
 * Many libraries check for MutationObserver existence; this prevents crashes.
 * Does not actually observe DOM mutations (no layout engine).
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
 */
export class MutationObserver {
	constructor(_callback: (...args: unknown[]) => void) {}

	observe(_target: Node, _options?: MutationObserverOptions): void {
		// Stub — no actual mutation tracking
	}

	disconnect(): void {
		// Stub
	}

	takeRecords(): unknown[] {
		return [];
	}
}
