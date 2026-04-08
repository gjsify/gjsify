// Ambient declaration for bare web aliases used by spec files.
// `abort-controller` is a sibling @gjsify/* package resolved via esbuild aliases
// at build time, but TypeScript needs a stub declaration to type-check the specs.
// This file is a script (no top-level export) so the `declare module` creates
// a new ambient module rather than augmenting an existing one.

declare module 'abort-controller' {
	class AbortController {
		readonly signal: AbortSignal;
		abort(reason?: unknown): void;
	}
	class AbortSignal extends EventTarget {
		readonly aborted: boolean;
		readonly reason: unknown;
		throwIfAborted(): void;
		onabort: ((this: AbortSignal, ev: Event) => unknown) | null;
		static abort(reason?: unknown): AbortSignal;
		static timeout(milliseconds: number): AbortSignal;
		static any(signals: AbortSignal[]): AbortSignal;
	}
	export { AbortController, AbortSignal };
}
