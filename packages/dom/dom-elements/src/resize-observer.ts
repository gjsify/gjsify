// ResizeObserver stub for GJS — original implementation
// Reference: refs/happy-dom/packages/happy-dom/src/resize-observer/ResizeObserver.ts
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Stub implementation — no actual resize tracking

import type { Element } from './element.js';

/**
 * ResizeObserver stub.
 * Many libraries check for ResizeObserver existence; this prevents crashes.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver
 */
export class ResizeObserver {
	constructor(_callback: (...args: unknown[]) => void) {}

	observe(_target: Element): void {
		// Stub
	}

	unobserve(_target: Element): void {
		// Stub
	}

	disconnect(): void {
		// Stub
	}
}
