// Ambient module augmentation for spec files only.
//
// White-box tests probe internal stream state (`_readableState`, `_writableState`)
// that exists on real Node.js streams but is not part of `@types/node`. This file
// is included by `tsconfig.spec.json` (not `tsconfig.json`), so the augmented
// shape is visible to specs without leaking into the public package types.

declare module 'node:stream' {
	interface Readable {
		_readableState: {
			highWaterMark: number;
			objectMode: boolean;
			pipes: Writable[];
			ended?: boolean;
			endEmitted?: boolean;
			reading?: boolean;
			constructed?: boolean;
		};
	}
	interface Writable {
		_writableState: {
			highWaterMark: number;
			objectMode: boolean;
		};
	}
}

export {};
