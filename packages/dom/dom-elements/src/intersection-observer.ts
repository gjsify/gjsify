// IntersectionObserver stub for GJS.
// Reference: refs/happy-dom/packages/happy-dom/src/intersection-observer/IntersectionObserver.ts
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Stub implementation — no actual intersection tracking

import type { Element } from './element.js';

/**
 * Tracks no intersections. It exists because many libraries check for `IntersectionObserver` and
 * crash without it.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver
 */
export class IntersectionObserver {
    readonly root: Element | null;
    readonly rootMargin: string;
    readonly thresholds: readonly number[];

    constructor(
        _callback: (...args: unknown[]) => void,
        options?: { root?: Element | null; rootMargin?: string; threshold?: number | number[] },
    ) {
        this.root = options?.root ?? null;
        this.rootMargin = options?.rootMargin ?? '0px';
        this.thresholds = Array.isArray(options?.threshold) ? options.threshold : [options?.threshold ?? 0];
    }

    observe(_target: Element): void {}

    unobserve(_target: Element): void {}

    disconnect(): void {}

    takeRecords(): unknown[] {
        return [];
    }
}
